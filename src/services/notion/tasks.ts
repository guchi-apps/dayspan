import type { Client } from "@notionhq/client";
import type { NotionConnection } from "@prisma/client";

import type { TaskItem } from "@/types/calendar";

import type { PropertyMap } from "./task-database";

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

  const dueProperty = get("due");
  const dueStart = dueProperty?.type === "date" ? (dueProperty.date?.start ?? null) : null;

  return {
    kind: "task",
    id: page.id,
    title: plainText(get("title")?.title) || "(タイトルなし)",
    due: dueStart,
    // Notionの日付は「日付のみ」なら YYYY-MM-DD、時刻ありなら時刻部分を含む。
    hasTime: Boolean(dueStart && dueStart.includes("T")),
    done: readDone(get("done")),
    priority: readChoice(get("priority")),
    tags: (get("tags")?.multi_select ?? []).map((tag) => tag.name ?? "").filter(Boolean),
    memo: plainText(get("memo")?.rich_text) || null,
    recurrence: readChoice(get("recurrence")),
    url: page.url ?? null,
  };
}

async function queryTasks(
  notion: Client,
  dataSourceId: string,
  filter: Record<string, unknown> | undefined,
): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      ...(filter ? { filter: filter as never } : {}),
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

/**
 * 指定期間に期限があるタスクを取得する。
 * 期限未設定のタスクはカレンダーに表示しないため、ここでは取得しない（docs/spec.md §10）。
 */
export async function listTasksInRange(
  notion: Client,
  connection: NotionConnection,
  range: { from: string; to: string },
): Promise<TaskItem[]> {
  const propertyMap = (connection.propertyMap as PropertyMap | null) ?? {};
  const dueProperty = propertyMap.due;

  if (!connection.taskDataSourceId || !dueProperty) return [];

  const pages = await queryTasks(notion, connection.taskDataSourceId, {
    and: [
      { property: dueProperty, date: { on_or_after: range.from } },
      { property: dueProperty, date: { on_or_before: range.to } },
    ],
  });

  return pages.map((page) => normalizeTask(page, propertyMap));
}

/** タスク画面用に全件取得する（期限未設定・完了済みを含む）。 */
export async function listAllTasks(
  notion: Client,
  connection: NotionConnection,
): Promise<TaskItem[]> {
  const propertyMap = (connection.propertyMap as PropertyMap | null) ?? {};
  if (!connection.taskDataSourceId) return [];

  const pages = await queryTasks(notion, connection.taskDataSourceId, undefined);
  return pages.map((page) => normalizeTask(page, propertyMap));
}
