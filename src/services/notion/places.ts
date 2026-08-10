import type { NotionConnection } from "@prisma/client";

import { createNotionClient } from "./client";
import type { PlacePropertyMap } from "./place-database";

/**
 * よく行く場所（docs/spec.md §9）。予定の「場所」欄の入力候補として使う。
 * 一次情報源はNotionで、DaySpan側には保存しない。
 */
export type PlaceItem = {
  id: string;
  name: string;
  address: string | null;
  tags: string[];
};

type PropertyValue = {
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  multi_select?: Array<{ name?: string }>;
};
type Page = { id: string; properties?: Record<string, PropertyValue> };

const text = (items?: Array<{ plain_text?: string }>) =>
  items?.map((item) => item.plain_text ?? "").join("").trim() || "";

function normalize(page: Page, map: PlacePropertyMap): PlaceItem | null {
  const get = (field: keyof PlacePropertyMap) => (map[field] ? page.properties?.[map[field]!] : undefined);
  const name = text(get("name")?.title);
  // 名前の無い行は候補として出しても選べない。空行は落とす。
  if (!name) return null;
  return {
    id: page.id,
    name,
    address: text(get("address")?.rich_text) || null,
    tags: get("tags")?.multi_select?.map((option) => option.name ?? "").filter(Boolean) ?? [],
  };
}

/**
 * 登録済みの場所を取得する。
 *
 * 取得に失敗しても画面は開けるようにする。場所は入力の候補であって、予定を読むために
 * 要るものではないため、失敗は空として扱う（tag-options.ts と同じ考え方）。
 */
export async function loadPlaces(connection: NotionConnection | null): Promise<PlaceItem[]> {
  if (!connection?.placeDataSourceId) return [];
  const map = (connection.placePropertyMap as PlacePropertyMap | null) ?? {};
  if (!map.name) return [];

  try {
    const notion = createNotionClient(connection);
    const pages: Page[] = [];
    let cursor: string | undefined;
    do {
      const response = await notion.dataSources.query({
        data_source_id: connection.placeDataSourceId,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const result of response.results) {
        if (result.object === "page" && "properties" in result) pages.push(result as Page);
      }
      cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    } while (cursor);

    return pages.map((page) => normalize(page, map)).filter((item): item is PlaceItem => item !== null);
  } catch {
    return [];
  }
}

/**
 * 場所の候補一式。DBが未設定なのか、設定済みで1件も登録が無いのかで画面の案内が違うため、
 * 設定済みかどうかを ready で分けて持つ（tag-options.ts の TagCatalog と同じ考え方）。
 */
export type PlaceCatalog = { ready: boolean; places: PlaceItem[] };

export const EMPTY_PLACE_CATALOG: PlaceCatalog = { ready: false, places: [] };

export async function loadPlaceCatalog(connection: NotionConnection | null): Promise<PlaceCatalog> {
  if (!connection?.placeDataSourceId) return EMPTY_PLACE_CATALOG;
  return { ready: true, places: await loadPlaces(connection) };
}

/** 場所を1件追加する。すでに同じ名前があれば作らず、その場所を返す。 */
export async function createPlace(
  connection: NotionConnection,
  input: { name: string; address?: string | null },
): Promise<PlaceItem> {
  if (!connection.placeDataSourceId) throw new Error("Place data source is not configured");
  const map = (connection.placePropertyMap as PlacePropertyMap | null) ?? {};
  if (!map.name) throw new Error("Place name property is not configured");

  const existing = (await loadPlaces(connection)).find((place) => place.name === input.name);
  if (existing) return existing;

  const properties: Record<string, unknown> = {
    [map.name]: { title: [{ type: "text", text: { content: input.name } }] },
  };
  if (map.address && input.address) {
    properties[map.address] = { rich_text: [{ type: "text", text: { content: input.address } }] };
  }

  const notion = createNotionClient(connection);
  const page = await notion.pages.create({
    parent: { type: "data_source_id", data_source_id: connection.placeDataSourceId },
    properties: properties as never,
  });

  return { id: page.id, name: input.name, address: input.address ?? null, tags: [] };
}
