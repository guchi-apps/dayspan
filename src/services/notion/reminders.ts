import type { Client } from "@notionhq/client";
import type { NotionConnection } from "@prisma/client";

import type { ReminderItem } from "@/types/calendar";

import type { NotionQueryFilter } from "./client";
import type { ReminderField, ReminderPropertyMap } from "./reminder-database";

type PropertyValue = {
  type?: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  select?: { name?: string } | null;
  date?: { start?: string | null } | null;
  checkbox?: boolean;
};
/** 日付リマインドDBと同じプロパティ構成を持つページ。ゴミの日DBもこの形で読む。 */
export type DatePage = { id: string; url?: string; properties?: Record<string, PropertyValue> };

const text = (items?: Array<{ plain_text?: string }>) =>
  items?.map((item) => item.plain_text ?? "").join("").trim() || "";

/**
 * Notionのページを表示用の形へ直す。
 *
 * ゴミの日DB（myroomが書き出す・docs/spec.md §9）はプロパティ構成が日付リマインドDBの部分集合で、
 * 読み方も同じため、出どころだけを引数で分けてこの関数を共用する。
 */
export function normalizeDatePage(
  page: DatePage,
  map: ReminderPropertyMap,
  source: ReminderItem["source"],
): ReminderItem | null {
  const get = (field: keyof ReminderPropertyMap) => map[field] ? page.properties?.[map[field]!] : undefined;
  const date = get("date")?.date?.start ?? null;
  if (!date) return null;
  const annualProperty = get("annual");
  return {
    kind: "reminder",
    source,
    id: page.id,
    pageId: page.id,
    title: text(get("title")?.title) || "(タイトルなし)",
    date,
    sourceDate: date,
    hasTime: date.includes("T"),
    category: get("category")?.select?.name ?? null,
    memo: text(get("memo")?.rich_text) || null,
    annual: annualProperty ? Boolean(annualProperty.checkbox) : null,
    url: page.url ?? null,
  };
}

/**
 * その年の同じ月日。2/29しか無い日付は、うるう年でない年を2/28へ寄せる。
 *
 * 専用一覧の並べ替え（services/notion/reminder-order.ts）からも呼ぶ。うるう日の寄せ方が
 * カレンダーの展開と一覧の並びで食い違うと、同じ項目が別の日に見えるため1か所に置く。
 */
export function sameDayOfYear(year: number, month: string, day: string): string {
  const candidate = `${String(year).padStart(4, "0")}-${month}-${day}`;
  // UTCで組み立てて、月が繰り上がったら（＝その年に無い日付なら）月末へ丸める。
  const date = new Date(`${candidate}T12:00:00Z`);
  if (String(date.getUTCMonth() + 1).padStart(2, "0") === month) return candidate;
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

/**
 * 毎年の日付リマインドを、表示範囲に入る各年へ展開する。
 *
 * 記念日・更新日は登録した日が起点なので、それより前の年には出さない。
 * 展開した項目は元ページと同じ内容だが、月ごとの保持・描画で1件に潰されないよう
 * IDへ日付を足して回ごとに別物にする（use-calendar-chunks.ts）。
 */
function expandAnnual(reminder: ReminderItem, range: { from: string; to: string }): ReminderItem[] {
  const baseDate = reminder.date.slice(0, 10);
  const time = reminder.hasTime ? reminder.date.slice(10) : "";
  const month = baseDate.slice(5, 7);
  const day = baseDate.slice(8, 10);

  const items: ReminderItem[] = [];

  for (let year = Number(range.from.slice(0, 4)); year <= Number(range.to.slice(0, 4)); year += 1) {
    const dateKey = sameDayOfYear(year, month, day);
    if (dateKey < baseDate) continue;
    if (dateKey < range.from || dateKey > range.to) continue;
    // sourceDate は元ページの日付のまま残す。編集画面はそちらを初期値にする。
    items.push({ ...reminder, id: `${reminder.id}:${dateKey}`, date: `${dateKey}${time}` });
  }

  return items;
}

export async function queryDatePages(
  notion: Client,
  dataSourceId: string,
  filter?: NotionQueryFilter,
): Promise<DatePage[]> {
  const pages: DatePage[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      ...(filter ? { filter } : {}),
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const result of response.results) {
      if (result.object === "page" && "properties" in result) pages.push(result as DatePage);
    }
    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (cursor);
  return pages;
}

/** 日付プロパティが表示範囲に入っているページだけを取るフィルタ。 */
export function dateRangeFilter(propertyName: string, range: { from: string; to: string }) {
  return {
    and: [
      { property: propertyName, date: { on_or_after: range.from } },
      { property: propertyName, date: { on_or_before: range.to } },
    ],
  };
}

export async function listRemindersInRange(notion: Client, connection: NotionConnection, range: { from: string; to: string }) {
  const map = (connection.reminderPropertyMap as ReminderPropertyMap | null) ?? {};
  if (!connection.reminderDataSourceId || !map.date) return [];

  const dataSourceId = connection.reminderDataSourceId;
  const toItems = (pages: DatePage[]) =>
    pages
      .map((page) => normalizeDatePage(page, map, "reminder"))
      .filter((item): item is ReminderItem => item !== null);

  // 毎年の項目は、登録した年（＝日付プロパティの年）が表示範囲の外にあっても表示する。
  // 日付では絞り込めないため、日付で絞る取得とは別に、毎年の項目だけを丸ごと取りにいく。
  const [dated, annual] = await Promise.all([
    queryDatePages(notion, dataSourceId, dateRangeFilter(map.date, range)).then(toItems),
    map.annual
      ? queryDatePages(notion, dataSourceId, {
          property: map.annual,
          checkbox: { equals: true },
        }).then(toItems)
      : Promise.resolve([]),
  ]);

  // 登録した年が範囲に入っている毎年の項目は両方に現れる。展開した側だけを残す。
  const annualIds = new Set(annual.map((item) => item.id));

  return [
    ...dated.filter((item) => !annualIds.has(item.id)),
    ...annual.flatMap((item) => expandAnnual(item, range)),
  ];
}

export async function listAllReminders(notion: Client, connection: NotionConnection) {
  const map = (connection.reminderPropertyMap as ReminderPropertyMap | null) ?? {};
  if (!connection.reminderDataSourceId) return [];
  const pages = await queryDatePages(notion, connection.reminderDataSourceId);
  return pages
    .map((page) => normalizeDatePage(page, map, "reminder"))
    .filter((item): item is ReminderItem => item !== null);
}

// --- 日付リマインドの作成・更新・削除 ---

export type ReminderWriteInput = {
  title?: string;
  /** YYYY-MM-DD（日付のみ）/ ISO 8601（時刻あり） */
  date?: string;
  category?: string | null;
  memo?: string | null;
  annual?: boolean;
};

/**
 * 入力をNotionのプロパティ形へ変換する。
 * DBに無い項目（propertyMapに無いもの）は書き込まず落とす。任意項目が無いのは正常なため。
 */
function toProperties(input: ReminderWriteInput, map: ReminderPropertyMap): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const set = (field: ReminderField, value: unknown) => {
    const name = map[field];
    if (name) properties[name] = value;
  };

  if (input.title !== undefined) {
    set("title", { title: [{ type: "text", text: { content: input.title } }] });
  }
  if (input.date !== undefined) {
    set("date", { date: { start: input.date } });
  }
  if (input.category !== undefined) {
    set("category", { select: input.category ? { name: input.category } : null });
  }
  if (input.memo !== undefined) {
    set("memo", { rich_text: input.memo ? [{ type: "text", text: { content: input.memo } }] : [] });
  }
  if (input.annual !== undefined) {
    set("annual", { checkbox: input.annual });
  }

  return properties;
}

export async function createReminder(
  notion: Client,
  connection: NotionConnection,
  input: ReminderWriteInput,
): Promise<{ id: string }> {
  if (!connection.reminderDataSourceId) throw new Error("Reminder data source is not configured");
  const map = (connection.reminderPropertyMap as ReminderPropertyMap | null) ?? {};

  const page = await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: connection.reminderDataSourceId },
    properties: toProperties(input, map) as never,
  });

  return { id: page.id };
}

/** 日付リマインドDB以外のページを書き換えようとしたときのエラー。API側で403に変える。 */
export class ReminderNotEditableError extends Error {
  constructor() {
    super("This page is not in the reminder data source");
    this.name = "ReminderNotEditableError";
  }
}

/**
 * 対象ページが日付リマインドDBのものか確かめる。
 *
 * ゴミの日DBのように外部アプリ（myroom）が正で、DaySpanからは読むだけのDBを、
 * APIから直接書き換えられないようにする。UIで入口を隠すだけだと、DaySpanのAPIや
 * 将来のMCPから直接呼ばれた要求が素通りするため、経路によらず同じ結果になるここで断る。
 *
 * 代償として更新・削除のたびにNotionへの往復が1回増える。読み取り側は増えない。
 */
async function assertReminderPage(
  notion: Client,
  connection: NotionConnection,
  reminderId: string,
): Promise<void> {
  if (!connection.reminderDataSourceId) throw new ReminderNotEditableError();

  const page = await notion.pages.retrieve({ page_id: reminderId });
  const parent = "parent" in page ? page.parent : null;
  const dataSourceId = parent?.type === "data_source_id" ? parent.data_source_id : null;
  // NotionのIDはハイフン付き・無しのどちらの表記でも同じものを指す。取得元によって表記が
  // 変わっても弾かないよう、比較の前に揃える。
  const sameId = (a: string | null, b: string | null) =>
    a !== null && b !== null && a.replaceAll("-", "").toLowerCase() === b.replaceAll("-", "").toLowerCase();

  if (!sameId(dataSourceId, connection.reminderDataSourceId)) throw new ReminderNotEditableError();
}

export async function updateReminder(
  notion: Client,
  connection: NotionConnection,
  reminderId: string,
  input: ReminderWriteInput,
): Promise<void> {
  await assertReminderPage(notion, connection, reminderId);
  const map = (connection.reminderPropertyMap as ReminderPropertyMap | null) ?? {};
  await notion.pages.update({
    page_id: reminderId,
    properties: toProperties(input, map) as never,
  });
}

/**
 * 日付リマインドを消す。完了状態を持たないため、残す意味のない項目は消せる必要がある。
 * Notionのゴミ箱へ移すだけなので、間違えてもNotion側で戻せる。
 */
export async function deleteReminder(
  notion: Client,
  connection: NotionConnection,
  reminderId: string,
): Promise<void> {
  await assertReminderPage(notion, connection, reminderId);
  await notion.pages.update({ page_id: reminderId, in_trash: true });
}
