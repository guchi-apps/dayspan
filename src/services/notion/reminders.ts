import type { Client } from "@notionhq/client";
import type { NotionConnection } from "@prisma/client";

import type { ReminderItem } from "@/types/calendar";
import type { ReminderPropertyMap } from "./reminder-database";

type PropertyValue = {
  type?: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  select?: { name?: string } | null;
  date?: { start?: string | null } | null;
  checkbox?: boolean;
};
type Page = { id: string; url?: string; properties?: Record<string, PropertyValue> };

const text = (items?: Array<{ plain_text?: string }>) =>
  items?.map((item) => item.plain_text ?? "").join("").trim() || "";

function normalize(page: Page, map: ReminderPropertyMap): ReminderItem | null {
  const get = (field: keyof ReminderPropertyMap) => map[field] ? page.properties?.[map[field]!] : undefined;
  const date = get("date")?.date?.start ?? null;
  if (!date) return null;
  const annualProperty = get("annual");
  return {
    kind: "reminder",
    id: page.id,
    title: text(get("title")?.title) || "(タイトルなし)",
    date,
    hasTime: date.includes("T"),
    category: get("category")?.select?.name ?? null,
    memo: text(get("memo")?.rich_text) || null,
    annual: annualProperty ? Boolean(annualProperty.checkbox) : null,
    url: page.url ?? null,
  };
}

async function query(notion: Client, dataSourceId: string, filter?: Record<string, unknown>): Promise<Page[]> {
  const pages: Page[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      ...(filter ? { filter: filter as never } : {}),
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const result of response.results) {
      if (result.object === "page" && "properties" in result) pages.push(result as Page);
    }
    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (cursor);
  return pages;
}

export async function listRemindersInRange(notion: Client, connection: NotionConnection, range: { from: string; to: string }) {
  const map = (connection.reminderPropertyMap as ReminderPropertyMap | null) ?? {};
  if (!connection.reminderDataSourceId || !map.date) return [];
  const pages = await query(notion, connection.reminderDataSourceId, {
    and: [
      { property: map.date, date: { on_or_after: range.from } },
      { property: map.date, date: { on_or_before: range.to } },
    ],
  });
  return pages.map((page) => normalize(page, map)).filter((item): item is ReminderItem => item !== null);
}

export async function listAllReminders(notion: Client, connection: NotionConnection) {
  const map = (connection.reminderPropertyMap as ReminderPropertyMap | null) ?? {};
  if (!connection.reminderDataSourceId) return [];
  const pages = await query(notion, connection.reminderDataSourceId);
  return pages.map((page) => normalize(page, map)).filter((item): item is ReminderItem => item !== null);
}
