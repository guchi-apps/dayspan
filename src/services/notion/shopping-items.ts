import type { Client } from "@notionhq/client";
import type { NotionConnection } from "@prisma/client";

import { SHOPPING_PRIORITIES, type ShoppingItem, type ShoppingPriority } from "@/types/shopping";

import type { ShoppingField, ShoppingPropertyMap } from "./shopping-database";

/**
 * 買い物リストの読み書き（docs/spec.md §36）。
 *
 * 一次情報源はNotionの買い物リストDBで、DaySpanのDBには何も保存しない。別アプリ
 * （shopping-list）が同じDBを読み書きしているため、書き込みの形も向こうと揃える。
 */

type PropertyValue = {
  type?: string;
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  select?: { name?: string } | null;
  checkbox?: boolean;
};

type ShoppingPage = { id: string; url?: string; properties?: Record<string, PropertyValue> };

const text = (items?: Array<{ plain_text?: string }>) =>
  items?.map((item) => item.plain_text ?? "").join("").trim() || "";

export function shoppingPropertyMap(connection: NotionConnection): ShoppingPropertyMap {
  return (connection.shoppingPropertyMap as ShoppingPropertyMap | null) ?? {};
}

/** 買い物リストDBが読み書きできる状態か。データソースと項目名のプロパティが揃って初めて使える。 */
export function shoppingDatabaseReady(connection: NotionConnection | null): boolean {
  if (!connection?.shoppingDataSourceId) return false;
  return Boolean(shoppingPropertyMap(connection).title);
}

/** Notion側で自由に足せる選択肢のため、DaySpanが知らない名前は優先度なしとして扱う。 */
function toPriority(name: string | undefined): ShoppingPriority {
  return (SHOPPING_PRIORITIES as readonly string[]).includes(name ?? "")
    ? (name as NonNullable<ShoppingPriority>)
    : null;
}

function normalizeShoppingPage(page: ShoppingPage, map: ShoppingPropertyMap): ShoppingItem | null {
  const get = (field: ShoppingField) => (map[field] ? page.properties?.[map[field]!] : undefined);

  const name = text(get("title")?.title);
  // 名前が空の行はNotion上で「新規」のまま置かれたページ。買い物の一覧には出さない。
  if (!name) return null;

  return {
    id: page.id,
    name,
    category: get("category")?.select?.name ?? null,
    memo: text(get("memo")?.rich_text) || null,
    priority: toPriority(get("priority")?.select?.name),
    bought: get("bought")?.checkbox === true,
    url: page.url ?? null,
  };
}

/**
 * 買い物リストを全件取得する。
 *
 * 日付を持たないため範囲で絞れない。買い切りのリストで件数も数十件に収まる想定なので、
 * `has_more` の間ページングして全件を読む（場所DBと同じ扱い）。
 */
export async function listShoppingItems(
  notion: Client,
  connection: NotionConnection,
): Promise<ShoppingItem[]> {
  if (!connection.shoppingDataSourceId) return [];
  const map = shoppingPropertyMap(connection);
  if (!map.title) return [];

  const items: ShoppingItem[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({
      data_source_id: connection.shoppingDataSourceId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const result of response.results) {
      if (result.object !== "page" || !("properties" in result)) continue;
      const item = normalizeShoppingPage(result as ShoppingPage, map);
      if (item) items.push(item);
    }
    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (cursor);

  return items;
}

export type ShoppingWriteInput = {
  name?: string;
  category?: string | null;
  memo?: string | null;
  priority?: ShoppingPriority;
  bought?: boolean;
};

function toProperties(
  input: ShoppingWriteInput,
  map: ShoppingPropertyMap,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const set = (field: ShoppingField, value: unknown) => {
    const name = map[field];
    if (name) properties[name] = value;
  };

  if (input.name !== undefined) {
    set("title", { title: [{ type: "text", text: { content: input.name } }] });
  }
  if (input.category !== undefined) {
    set("category", { select: input.category ? { name: input.category } : null });
  }
  if (input.memo !== undefined) {
    set("memo", { rich_text: input.memo ? [{ type: "text", text: { content: input.memo } }] : [] });
  }
  if (input.priority !== undefined) {
    set("priority", { select: input.priority ? { name: input.priority } : null });
  }
  if (input.bought !== undefined) {
    set("bought", { checkbox: input.bought });
  }

  return properties;
}

/** 買い物リストDB以外のページを書き換えようとしたときのエラー。API側で403に変える。 */
export class ShoppingItemNotEditableError extends Error {
  constructor() {
    super("This page is not in the shopping data source");
    this.name = "ShoppingItemNotEditableError";
  }
}

/**
 * 対象ページが買い物リストDBのものか確かめる。
 *
 * UIで入口を隠すだけだと、DaySpanのAPIや将来のMCPから直接呼ばれた要求が素通りする。
 * 日付リマインド・勤務記録と同じ考え方で、経路によらずここで断る。
 */
async function assertShoppingPage(
  notion: Client,
  connection: NotionConnection,
  pageId: string,
): Promise<void> {
  if (!connection.shoppingDataSourceId) throw new ShoppingItemNotEditableError();

  const page = await notion.pages.retrieve({ page_id: pageId });
  const parent = "parent" in page ? page.parent : null;
  const dataSourceId = parent?.type === "data_source_id" ? parent.data_source_id : null;
  // NotionのIDはハイフン付き・無しのどちらの表記でも同じものを指す。比較の前に揃える。
  const sameId = (a: string | null, b: string | null) =>
    a !== null &&
    b !== null &&
    a.replaceAll("-", "").toLowerCase() === b.replaceAll("-", "").toLowerCase();

  if (!sameId(dataSourceId, connection.shoppingDataSourceId)) {
    throw new ShoppingItemNotEditableError();
  }
}

export async function createShoppingItem(
  notion: Client,
  connection: NotionConnection,
  input: ShoppingWriteInput & { name: string },
): Promise<ShoppingItem> {
  if (!connection.shoppingDataSourceId) throw new Error("Shopping data source is not configured");
  const map = shoppingPropertyMap(connection);

  const page = await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: connection.shoppingDataSourceId },
    // 追加した項目は未購入から始まる。送られてこなくても false を書いておかないと、
    // Notion側の既定（未設定＝false）に頼ることになり、DBの構成で結果が変わる。
    properties: toProperties({ bought: false, ...input }, map) as never,
  });

  return {
    id: page.id,
    name: input.name,
    category: input.category ?? null,
    memo: input.memo ?? null,
    priority: input.priority ?? null,
    bought: input.bought ?? false,
    url: "url" in page ? (page.url ?? null) : null,
  };
}

export async function updateShoppingItem(
  notion: Client,
  connection: NotionConnection,
  pageId: string,
  input: ShoppingWriteInput,
): Promise<void> {
  await assertShoppingPage(notion, connection, pageId);

  await notion.pages.update({
    page_id: pageId,
    properties: toProperties(input, shoppingPropertyMap(connection)) as never,
  });
}

/** 項目を消す。Notionのゴミ箱へ移すだけなので、間違えてもNotion側で戻せる。 */
export async function deleteShoppingItem(
  notion: Client,
  connection: NotionConnection,
  pageId: string,
): Promise<void> {
  await assertShoppingPage(notion, connection, pageId);
  await notion.pages.update({ page_id: pageId, in_trash: true });
}
