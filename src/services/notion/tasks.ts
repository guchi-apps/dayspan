import type { Client } from "@notionhq/client";
import type { NotionConnection } from "@prisma/client";

import type { TaskItem } from "@/types/calendar";

import type { NotionQueryFilter } from "./client";
import { formatRecurrence, nextDue, parseRecurrence } from "./recurrence";
import { externalApiMessage } from "@/lib/api-error";
import { db } from "@/lib/db";

import {
  resolveRefreshedPropertyMap,
  SKIPPED_OUTCOME,
  validateTaskDataSource,
  type PropertyMap,
} from "./task-database";

// Notionのページプロパティは型ごとに形が違ううえ、完了状態や優先度は
// ユーザーの設定次第で checkbox / status / select のどれにもなりうる。
// 読み取り側で実際の type を見て解釈する。

type NotionPropertyValue = {
  type?: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  checkbox?: boolean;
  status?: { name?: string } | null;
  select?: { name?: string } | null;
  multi_select?: Array<{ name?: string }>;
  date?: { start?: string | null; end?: string | null } | null;
};

type NotionPage = {
  id: string;
  url?: string;
  properties?: Record<string, NotionPropertyValue>;
};

const DONE_STATUS_PATTERN = /完了|done|complete|済/i;

function plainText(items: Array<{ plain_text?: string }> | undefined): string {
  if (!items || items.length === 0) return "";
  return items.map((item) => item.plain_text ?? "").join("").trim();
}

function readDone(property: NotionPropertyValue | undefined): boolean {
  if (!property) return false;
  if (property.type === "checkbox") return Boolean(property.checkbox);
  // status型はグループ（未着手/進行中/完了）をAPIから判別できないため、名前で判定する。
  if (property.type === "status") return DONE_STATUS_PATTERN.test(property.status?.name ?? "");
  return false;
}

function readChoice(property: NotionPropertyValue | undefined): string | null {
  if (!property) return null;
  if (property.type === "select") return property.select?.name ?? null;
  if (property.type === "status") return property.status?.name ?? null;
  return null;
}

export function normalizeTask(page: NotionPage, propertyMap: PropertyMap): TaskItem {
  const properties = page.properties ?? {};
  const get = (field: keyof PropertyMap) => {
    const name = propertyMap[field];
    return name ? properties[name] : undefined;
  };

  const dateStart = (property: NotionPropertyValue | undefined): string | null =>
    property?.type === "date" ? (property.date?.start ?? null) : null;

  const dueStart = dateStart(get("due"));
  const plannedStart = dateStart(get("planned"));

  const skipped = readChoice(get("outcome")) === SKIPPED_OUTCOME;

  return {
    kind: "task",
    id: page.id,
    title: plainText(get("title")?.title) || "(タイトルなし)",
    due: dueStart,
    // Notionの日付は「日付のみ」なら YYYY-MM-DD、時刻ありなら時刻部分を含む。
    hasTime: Boolean(dueStart && dueStart.includes("T")),
    planned: plannedStart,
    plannedHasTime: Boolean(plannedStart && plannedStart.includes("T")),
    // 「対応しない」は完了と同じく片付いたものとして扱う（docs/spec.md §12）。
    done: readDone(get("done")) || skipped,
    skipped,
    canSkip: Boolean(propertyMap.outcome),
    priority: readChoice(get("priority")),
    tags: (get("tags")?.multi_select ?? []).map((tag) => tag.name ?? "").filter(Boolean),
    memo: plainText(get("memo")?.rich_text) || null,
    recurrence: readChoice(get("recurrence")),
    // 予定への紐づけはDaySpanのDBにある（docs/spec.md §31）。Notionの応答からは分からないため、
    // ここでは空にしておき、読み込み側（services/task-links/links.ts）で埋める。
    links: [],
    url: page.url ?? null,
  };
}

async function queryTasks(
  notion: Client,
  dataSourceId: string,
  filter: NotionQueryFilter | undefined,
): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      ...(filter ? { filter } : {}),
      ...(cursor ? { start_cursor: cursor } : {}),
    });

    for (const result of response.results) {
      if (result.object !== "page") continue;
      if (!("properties" in result)) continue;
      pages.push(result as NotionPage);
    }

    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (cursor);

  return pages;
}

/** 対応付けの取り直しの間隔。取得のたびに `dataSources.retrieve` が1往復増えるのを避ける（docs/spec.md §20）。 */
const PROPERTY_MAP_REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * Notion側でプロパティを足した・改名した場合に追従できるよう、保存済みの対応付けを
 * 一定間隔で取り直す。読み取りだけで、Notionは書き換えない。
 * 失敗しても既存の対応付けで続行する（タスクの取得自体は止めない）。
 * `lastValidatedAt` は他のDB（勤務・場所など）の検証でも更新されるため、間隔は目安になる。
 */
export async function refreshTaskPropertyMapIfStale(
  notion: Client,
  connection: NotionConnection,
  { force = false }: { force?: boolean } = {},
): Promise<NotionConnection> {
  if (!connection.taskDataSourceId) return connection;
  const validatedAt = connection.lastValidatedAt?.getTime() ?? 0;
  if (!force && Date.now() - validatedAt < PROPERTY_MAP_REFRESH_MS) return connection;

  try {
    const validation = await validateTaskDataSource(notion, connection.taskDataSourceId);
    const next = resolveRefreshedPropertyMap(
      connection.propertyMap as PropertyMap | null,
      validation,
    );
    const updated = await db.notionConnection.update({
      where: { userId: connection.userId },
      data: {
        ...(next ? { propertyMap: next } : {}),
        lastValidatedAt: new Date(),
      },
    });
    return updated;
  } catch (error) {
    externalApiMessage("notion", "タスクDBの対応付けの再取得", error);
    return connection;
  }
}

/**
 * 指定期間に期限または予定日があるタスクを取得する。
 * どちらも未設定のタスクはカレンダーに置く日が決まらないため取得しない（docs/spec.md §10）。
 * 完了したタスクもカレンダーには出さない。履歴はタスク画面の「完了」から確認できる（docs/spec.md §12）。
 *
 * 予定日だけが期間内のタスクも要る。期限が半年先でも、予定日がこの月にあれば
 * その日のカレンダーに出す必要があるため、期限での絞り込みだけでは足りない。
 *
 * 完了状態はcheckbox/statusのどちらでもありえ、Notion側のフィルタ条件を型ごとに
 * 出し分けるより、取得後にnormalizeTaskの判定結果で絞るほうが単純なため後段で除く。
 */
export async function listTasksInRange(
  notion: Client,
  initialConnection: NotionConnection,
  range: { from: string; to: string },
): Promise<TaskItem[]> {
  const connection = await refreshTaskPropertyMapIfStale(notion, initialConnection);
  const propertyMap = (connection.propertyMap as PropertyMap | null) ?? {};
  const dueProperty = propertyMap.due;

  if (!connection.taskDataSourceId || !dueProperty) return [];

  const withinRange = (property: string) => ({
    and: [
      { property, date: { on_or_after: range.from } },
      { property, date: { on_or_before: range.to } },
    ],
  });

  const plannedProperty = propertyMap.planned;

  const pages = await queryTasks(
    notion,
    connection.taskDataSourceId,
    plannedProperty
      ? { or: [withinRange(dueProperty), withinRange(plannedProperty)] }
      : withinRange(dueProperty),
  );

  return pages.map((page) => normalizeTask(page, propertyMap)).filter((task) => !task.done);
}

/** タスク画面用に全件取得する（期限未設定・完了済みを含む）。 */
export async function listAllTasks(
  notion: Client,
  initialConnection: NotionConnection,
): Promise<TaskItem[]> {
  const connection = await refreshTaskPropertyMapIfStale(notion, initialConnection);
  const propertyMap = (connection.propertyMap as PropertyMap | null) ?? {};
  if (!connection.taskDataSourceId) return [];

  const pages = await queryTasks(notion, connection.taskDataSourceId, undefined);
  return pages.map((page) => normalizeTask(page, propertyMap));
}

// --- タスクの作成・更新・完了 ---

export type TaskWriteInput = {
  title?: string;
  /** YYYY-MM-DD（日付のみ）/ ISO 8601（時刻あり）/ null（期限未設定） */
  due?: string | null;
  /** 予定日。期限と同じ形式で、null は未設定。 */
  planned?: string | null;
  done?: boolean;
  priority?: string | null;
  memo?: string | null;
  tags?: string[];
  recurrence?: string | null;
  /** 対応状況。null は未設定（issue #750）。 */
  outcome?: string | null;
};

/**
 * 入力をNotionのプロパティ形へ変換する。DBに存在しない項目（propertyMapに無いもの）は
 * 書き込まず黙って落とす。ユーザーのタスクDBに必須でない項目が無いのは正常なため。
 */
function toProperties(
  input: TaskWriteInput,
  propertyMap: PropertyMap,
  doneType: "checkbox" | "status",
  doneStatusNames: { done: string; notDone: string },
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const set = (field: keyof PropertyMap, value: unknown) => {
    const name = propertyMap[field];
    if (name) properties[name] = value;
  };

  if (input.title !== undefined) {
    set("title", { title: [{ type: "text", text: { content: input.title } }] });
  }

  if (input.due !== undefined) {
    set("due", { date: input.due ? { start: input.due } : null });
  }

  if (input.planned !== undefined) {
    set("planned", { date: input.planned ? { start: input.planned } : null });
  }

  if (input.done !== undefined) {
    if (doneType === "status") {
      set("done", {
        status: { name: input.done ? doneStatusNames.done : doneStatusNames.notDone },
      });
    } else {
      set("done", { checkbox: input.done });
    }
  }

  if (input.priority !== undefined) {
    set("priority", { select: input.priority ? { name: input.priority } : null });
  }

  if (input.memo !== undefined) {
    set("memo", {
      rich_text: input.memo ? [{ type: "text", text: { content: input.memo } }] : [],
    });
  }

  if (input.tags !== undefined) {
    set("tags", { multi_select: input.tags.map((name) => ({ name })) });
  }

  if (input.recurrence !== undefined) {
    set("recurrence", { select: input.recurrence ? { name: input.recurrence } : null });
  }

  if (input.outcome !== undefined) {
    set("outcome", { select: input.outcome ? { name: input.outcome } : null });
  }

  return properties;
}

/** 完了状態のプロパティがcheckboxかstatusかを、既存ページの値から判別する。 */
async function resolveDoneType(
  notion: Client,
  connection: NotionConnection,
  propertyMap: PropertyMap,
): Promise<"checkbox" | "status"> {
  const name = propertyMap.done;
  if (!name || !connection.taskDataSourceId) return "checkbox";

  const dataSource = await notion.dataSources.retrieve({
    data_source_id: connection.taskDataSourceId,
  });
  const property = (dataSource.properties as Record<string, { type?: string }>)[name];

  return property?.type === "status" ? "status" : "checkbox";
}

// status型の場合、完了/未完了に相当する選択肢名はDBごとに違う。よくある名前から推測する。
const DONE_STATUS_FALLBACK = { done: "完了", notDone: "未着手" };

export async function createTask(
  notion: Client,
  connection: NotionConnection,
  input: TaskWriteInput,
): Promise<{ id: string }> {
  const propertyMap = (connection.propertyMap as PropertyMap | null) ?? {};
  if (!connection.taskDataSourceId) throw new Error("Task data source is not configured");

  const doneType = await resolveDoneType(notion, connection, propertyMap);

  const page = await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: connection.taskDataSourceId },
    properties: toProperties(
      { done: false, ...input },
      propertyMap,
      doneType,
      DONE_STATUS_FALLBACK,
    ) as never,
  });

  return { id: page.id };
}

export async function updateTask(
  notion: Client,
  connection: NotionConnection,
  taskId: string,
  input: TaskWriteInput,
): Promise<void> {
  const propertyMap = (connection.propertyMap as PropertyMap | null) ?? {};
  const doneType = await resolveDoneType(notion, connection, propertyMap);

  await notion.pages.update({
    page_id: taskId,
    properties: toProperties(input, propertyMap, doneType, DONE_STATUS_FALLBACK) as never,
  });
}

/**
 * タスクを完了にする。繰り返し設定があれば次回分を新規作成する。
 * 完了した回は履歴としてNotionに残す（削除しない。docs/spec.md §12・§13）。
 */
export async function completeTask(
  notion: Client,
  connection: NotionConnection,
  taskId: string,
  done: boolean,
): Promise<{ nextTaskId: string | null }> {
  const propertyMap = (connection.propertyMap as PropertyMap | null) ?? {};

  const page = await notion.pages.retrieve({ page_id: taskId });
  const current = "properties" in page ? normalizeTask(page as NotionPage, propertyMap) : null;

  // 「対応しない」から完了へ変える操作では、対応状況を外す（完了と対応しないは両立しない）。
  // 他の値（利用者が独自に足した選択肢）は触らない。
  await updateTask(notion, connection, taskId, {
    done,
    ...(current?.skipped ? { outcome: null } : {}),
  });

  // 未完了へ戻す操作では次回分を作らない。二重に増えてしまうため。
  if (!done || !current) return { nextTaskId: null };

  const recurrence = parseRecurrence(current.recurrence);
  const due = nextDue(current.due, recurrence);
  if (!due) return { nextTaskId: null };

  const created = await createTask(notion, connection, {
    title: current.title,
    due,
    // 予定日も同じ繰り返しで進める。前回の予定日をそのまま写すと、次回分が
    // 作られた時点で過ぎた日を指してしまうため。
    planned: nextDue(current.planned, recurrence),
    done: false,
    priority: current.priority,
    memo: current.memo,
    tags: current.tags,
    recurrence: formatRecurrence(recurrence),
  });

  return { nextTaskId: created.id };
}

/**
 * タスクを「対応しない」にする、または戻す（issue #750）。
 * 完了と違い、繰り返しの次回分は作らない。やらないと決めた回は次へ進めない扱いにする。
 * 完了状態も合わせて動かすのは、Notion側の一覧でも片付いたものとして並ぶようにするため。
 */
export async function skipTask(
  notion: Client,
  connection: NotionConnection,
  taskId: string,
  skipped: boolean,
): Promise<void> {
  const propertyMap = (connection.propertyMap as PropertyMap | null) ?? {};
  if (!propertyMap.outcome) throw new Error("このタスクDBには「対応状況」プロパティがありません。");

  await updateTask(notion, connection, taskId, {
    done: skipped,
    outcome: skipped ? SKIPPED_OUTCOME : null,
  });
}

/**
 * タスクを消す。完了したタスクは履歴として残す（docs/spec.md §12）が、
 * 要らなくなった・間違えて作ったタスクは残す意味がないため消せるようにする。
 * Notionのゴミ箱へ移すだけなので、間違えてもNotion側で戻せる。
 *
 * 繰り返しタスクは完了のたびに次回分を別ページとして作る方式のため、
 * ここで消えるのはこの回だけで、すでに作られた次回分は残る。
 */
export async function deleteTask(notion: Client, taskId: string): Promise<void> {
  await notion.pages.update({ page_id: taskId, in_trash: true });
}
