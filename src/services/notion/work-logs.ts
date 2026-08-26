import type { Client } from "@notionhq/client";
import type { NotionConnection } from "@prisma/client";

import type { WorkCapabilities, WorkRecordItem } from "@/types/work";

import type { WorkField, WorkPropertyMap } from "./work-database";

/**
 * 勤務場所・出張・年休の読み書き（docs/spec.md §34）。
 *
 * 一次情報源はNotionの勤務記録DBで、DaySpanのDBには何も保存しない。日付リマインドと同じく、
 * 利用者が後から見返し・集計し・手で直す種類の記録のため。
 */

type PropertyValue = {
  type?: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  select?: { name?: string } | null;
  date?: { start?: string | null; end?: string | null } | null;
  checkbox?: boolean;
};

type WorkPage = { id: string; url?: string; properties?: Record<string, PropertyValue> };

const text = (items?: Array<{ plain_text?: string }>) =>
  items?.map((item) => item.plain_text ?? "").join("").trim() || "";

/** 日付プロパティは時刻付きでも入りうる。勤務場所は終日の記録なので日付までに切る。 */
const dateKeyOf = (value: string | null | undefined): string | null =>
  value ? value.slice(0, 10) : null;

export function workPropertyMap(connection: NotionConnection): WorkPropertyMap {
  return (connection.workPropertyMap as WorkPropertyMap | null) ?? {};
}

/**
 * 勤務記録DBで使える項目。
 *
 * 出張の3つはどれか1つでも欠けると出張の管理が成立しない（出張だと分からない・申請の
 * 済み未済を持てない）ため、まとめて判定する。
 *
 * 年休も同じで、区分と事前申請の両方が要る。年休は事前に申請するもので、申請の済み未済を
 * 持てないなら記録できても片手落ちになる。事前申請は出張と同じ列を使う（指しているものが
 * 同じで、checkboxを増やすほど名前で当てる対応付けの取り違えの余地が増えるため）。
 */
export function workCapabilities(connection: NotionConnection | null): WorkCapabilities {
  if (!connection) {
    return { businessTrip: false, annualLeave: false, approval: false, memo: false };
  }
  const map = workPropertyMap(connection);
  return {
    businessTrip: Boolean(map.businessTrip),
    annualLeave: Boolean(map.annualLeave && map.preApplied),
    approval: Boolean(map.businessTrip && map.preApplied && map.postRegistered),
    memo: Boolean(map.memo),
  };
}

/**
 * 出張扱いにする勤務場所の名前（docs/spec.md §34）。
 *
 * 「行けば必ず出張になる勤務先」を場所ごとに覚えておき、その場所を選んだ時点で出張の既定を
 * 立てる。壊れた値（配列でない・文字列でない要素）は落として空として扱う。設定が読めないことを
 * 理由に勤務の記録そのものを止めないため。
 */
export function workTripPlaces(connection: NotionConnection | null): string[] {
  const value = connection?.workTripPlaces;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** 勤務記録DBが読み書きできる状態か。データソースと必須プロパティが揃って初めて使える。 */
export function workDatabaseReady(connection: NotionConnection | null): boolean {
  if (!connection?.workDataSourceId) return false;
  const map = workPropertyMap(connection);
  return Boolean(map.date && map.title);
}

function normalizeWorkPage(page: WorkPage, map: WorkPropertyMap): WorkRecordItem | null {
  const get = (field: WorkField) => (map[field] ? page.properties?.[map[field]!] : undefined);

  const startDate = dateKeyOf(get("date")?.date?.start);
  if (!startDate) return null;

  return {
    id: page.id,
    title: text(get("title")?.title) || "(タイトルなし)",
    startDate,
    // 単日の記録では end が空。期間の判定をどこでも同じ形で書けるよう、開始日で埋める。
    endDate: dateKeyOf(get("date")?.date?.end) ?? startDate,
    place: get("place")?.select?.name ?? null,
    annualLeave: get("annualLeave")?.select?.name ?? null,
    businessTrip: Boolean(get("businessTrip")?.checkbox),
    preApplied: Boolean(get("preApplied")?.checkbox),
    postRegistered: Boolean(get("postRegistered")?.checkbox),
    memo: text(get("memo")?.rich_text) || null,
    url: page.url ?? null,
  };
}

async function queryWorkPages(
  notion: Client,
  dataSourceId: string,
  filter?: Record<string, unknown>,
): Promise<WorkPage[]> {
  const pages: WorkPage[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      ...(filter ? { filter: filter as never } : {}),
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const result of response.results) {
      if (result.object === "page" && "properties" in result) pages.push(result as WorkPage);
    }
    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (cursor);
  return pages;
}

/**
 * 問い合わせの下限を、範囲の開始日から何日さかのぼるか。
 *
 * Notionの日付フィルタは範囲の開始日だけを見るため、`on_or_after: range.from` にすると
 * 範囲より前に始まって続いている出張が落ちる。かといって下限を置かないと、勤務記録は
 * 1日1件で増え続けるため、過去の全件をページングすることになる（5年で約1,800件＝18往復）。
 * カレンダーは月を送るたびにこれを通るので、現実的な出張の長さを超える幅で下限を作る。
 * これより長い期間の記録は、開始日が範囲の外にあると出てこない。
 */
const WORK_RANGE_LOOKBACK_DAYS = 92;

/** YYYY-MM-DD から日数をさかのぼった YYYY-MM-DD。時刻を持たないためUTCで数えて構わない。 */
function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * 期間に重なる勤務記録を取得する。
 *
 * 開始日が範囲の終わり以前・下限以降のものを採り、終了日での絞り込みはこちら側で行う
 * （Notionの日付フィルタは範囲の開始日しか見ないため）。
 */
export async function listWorkRecordsInRange(
  notion: Client,
  connection: NotionConnection,
  range: { from: string; to: string },
): Promise<WorkRecordItem[]> {
  const map = workPropertyMap(connection);
  if (!connection.workDataSourceId || !map.date) return [];

  const pages = await queryWorkPages(notion, connection.workDataSourceId, {
    and: [
      { property: map.date, date: { on_or_before: range.to } },
      {
        property: map.date,
        date: { on_or_after: shiftDateKey(range.from, -WORK_RANGE_LOOKBACK_DAYS) },
      },
    ],
  });

  return pages
    .map((page) => normalizeWorkPage(page, map))
    .filter((record): record is WorkRecordItem => record !== null)
    .filter((record) => record.endDate >= range.from)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * まだ手続きが済んでいない記録（出張の事前申請・事後登録と、年休の事前申請）。
 *
 * 事後登録が未対応かどうかは終了日を過ぎたかで決まり、Notionの日付フィルタでは判定できない
 * （範囲の開始日しか見ないため）。ここでは「どれかが未チェック」までを絞り込み、
 * 終了日の判定は `workTodos()` に任せる。年に数十件の規模のため、全件を採っても往復は1回。
 *
 * 出張と年休をひとつのクエリで採るのは、どちらもメニューの同じ数字（未対応の件数）になるため。
 * 分けると、その数字ひとつのためにNotionへの往復が2回になる。
 */
export async function listPendingWorkRecords(
  notion: Client,
  connection: NotionConnection,
): Promise<WorkRecordItem[]> {
  const map = workPropertyMap(connection);
  if (!connection.workDataSourceId || !map.date || !map.preApplied) return [];

  const conditions: Record<string, unknown>[] = [];
  if (map.businessTrip && map.postRegistered) {
    conditions.push({
      and: [
        { property: map.businessTrip, checkbox: { equals: true } },
        {
          or: [
            { property: map.preApplied, checkbox: { equals: false } },
            { property: map.postRegistered, checkbox: { equals: false } },
          ],
        },
      ],
    });
  }
  if (map.annualLeave) {
    conditions.push({
      and: [
        { property: map.annualLeave, select: { is_not_empty: true } },
        { property: map.preApplied, checkbox: { equals: false } },
      ],
    });
  }
  if (conditions.length === 0) return [];

  const pages = await queryWorkPages(notion, connection.workDataSourceId, { or: conditions });

  return pages
    .map((page) => normalizeWorkPage(page, map))
    .filter((record): record is WorkRecordItem => record !== null)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

// --- 作成・更新・削除 ---

export type WorkWriteInput = {
  title?: string;
  /** YYYY-MM-DD */
  startDate?: string;
  /** YYYY-MM-DD。単日なら startDate と同じ値、または null。 */
  endDate?: string | null;
  place?: string | null;
  /** 年休の区分（全休・午前半休・午後半休）。年休を外すときは null。 */
  annualLeave?: string | null;
  businessTrip?: boolean;
  preApplied?: boolean;
  postRegistered?: boolean;
  memo?: string | null;
};

/**
 * 入力をNotionのプロパティ形へ変換する。
 * DBに無い項目（propertyMapに無いもの）は書き込まず落とす。任意項目が無いのは正常なため。
 */
function toProperties(input: WorkWriteInput, map: WorkPropertyMap): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const set = (field: WorkField, value: unknown) => {
    const name = map[field];
    if (name) properties[name] = value;
  };

  if (input.title !== undefined) {
    set("title", { title: [{ type: "text", text: { content: input.title } }] });
  }
  if (input.startDate !== undefined) {
    // 単日の記録に end を入れると、Notion上で「8/25 → 8/25」の範囲として出る。
    // 同じ日で終わる期間は end を持たせない。
    const end = input.endDate && input.endDate !== input.startDate ? input.endDate : null;
    set("date", { date: { start: input.startDate, end } });
  }
  if (input.place !== undefined) {
    set("place", { select: input.place ? { name: input.place } : null });
  }
  if (input.annualLeave !== undefined) {
    set("annualLeave", { select: input.annualLeave ? { name: input.annualLeave } : null });
  }
  if (input.businessTrip !== undefined) {
    set("businessTrip", { checkbox: input.businessTrip });
  }
  if (input.preApplied !== undefined) {
    set("preApplied", { checkbox: input.preApplied });
  }
  if (input.postRegistered !== undefined) {
    set("postRegistered", { checkbox: input.postRegistered });
  }
  if (input.memo !== undefined) {
    set("memo", { rich_text: input.memo ? [{ type: "text", text: { content: input.memo } }] : [] });
  }

  return properties;
}

/** 勤務記録DB以外のページを書き換えようとしたときのエラー。API側で403に変える。 */
export class WorkRecordNotEditableError extends Error {
  constructor() {
    super("This page is not in the work data source");
    this.name = "WorkRecordNotEditableError";
  }
}

/**
 * 対象ページが勤務記録DBのものか確かめる。
 *
 * UIで入口を隠すだけだと、DaySpanのAPIや将来のMCPから直接呼ばれた要求が素通りする。
 * 日付リマインドの `assertReminderPage` と同じ考え方で、経路によらずここで断る。
 */
async function assertWorkPage(
  notion: Client,
  connection: NotionConnection,
  pageId: string,
): Promise<void> {
  if (!connection.workDataSourceId) throw new WorkRecordNotEditableError();

  const page = await notion.pages.retrieve({ page_id: pageId });
  const parent = "parent" in page ? page.parent : null;
  const dataSourceId = parent?.type === "data_source_id" ? parent.data_source_id : null;
  // NotionのIDはハイフン付き・無しのどちらの表記でも同じものを指す。比較の前に揃える。
  const sameId = (a: string | null, b: string | null) =>
    a !== null &&
    b !== null &&
    a.replaceAll("-", "").toLowerCase() === b.replaceAll("-", "").toLowerCase();

  if (!sameId(dataSourceId, connection.workDataSourceId)) throw new WorkRecordNotEditableError();
}

/** 同じ日にすでに登録がある（1日1件）ときのエラー。API側で409に変える。 */
export class WorkDateTakenError extends Error {
  readonly existingId: string;

  constructor(existingId: string) {
    super("Another work record already covers this date");
    this.name = "WorkDateTakenError";
    this.existingId = existingId;
  }
}

/**
 * 期間に重なる既存の記録を探す。
 *
 * 勤務場所は1日1件で、出張の期間にかかる日も含めて重ならないようにする。Notionには一意制約が
 * 無いため、保存のたびにこちらで確かめる（そのぶんNotionへの往復が1回増える）。
 * 同じページを編集しているときは自分自身を除く。
 */
async function findOverlapping(
  notion: Client,
  connection: NotionConnection,
  range: { startDate: string; endDate: string },
  excludeId?: string,
): Promise<WorkRecordItem | null> {
  const records = await listWorkRecordsInRange(notion, connection, {
    from: range.startDate,
    to: range.endDate,
  });

  const normalizedExclude = excludeId?.replaceAll("-", "").toLowerCase();
  return (
    records.find(
      (record) => record.id.replaceAll("-", "").toLowerCase() !== normalizedExclude,
    ) ?? null
  );
}

export async function createWorkRecord(
  notion: Client,
  connection: NotionConnection,
  input: WorkWriteInput & { startDate: string },
): Promise<WorkRecordItem> {
  if (!connection.workDataSourceId) throw new Error("Work data source is not configured");
  const map = workPropertyMap(connection);

  const endDate = input.endDate || input.startDate;
  const existing = await findOverlapping(notion, connection, {
    startDate: input.startDate,
    endDate,
  });
  if (existing) throw new WorkDateTakenError(existing.id);

  const page = await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: connection.workDataSourceId },
    properties: toProperties({ ...input, endDate }, map) as never,
  });

  return {
    id: page.id,
    title: input.title ?? "",
    startDate: input.startDate,
    endDate,
    place: input.place ?? null,
    annualLeave: input.annualLeave ?? null,
    businessTrip: Boolean(input.businessTrip),
    preApplied: Boolean(input.preApplied),
    postRegistered: Boolean(input.postRegistered),
    memo: input.memo ?? null,
    url: "url" in page ? (page.url ?? null) : null,
  };
}

export async function updateWorkRecord(
  notion: Client,
  connection: NotionConnection,
  pageId: string,
  input: WorkWriteInput,
): Promise<void> {
  await assertWorkPage(notion, connection, pageId);

  // 日付を動かすときだけ重なりを見る。申請のチェックだけを切り替える操作で
  // Notionへの往復を増やさないため。
  if (input.startDate) {
    const existing = await findOverlapping(
      notion,
      connection,
      { startDate: input.startDate, endDate: input.endDate || input.startDate },
      pageId,
    );
    if (existing) throw new WorkDateTakenError(existing.id);
  }

  const map = workPropertyMap(connection);
  await notion.pages.update({
    page_id: pageId,
    properties: toProperties(input, map) as never,
  });
}

/**
 * 勤務記録を消す。Notionのゴミ箱へ移すだけなので、間違えてもNotion側で戻せる。
 */
export async function deleteWorkRecord(
  notion: Client,
  connection: NotionConnection,
  pageId: string,
): Promise<void> {
  await assertWorkPage(notion, connection, pageId);
  await notion.pages.update({ page_id: pageId, in_trash: true });
}
