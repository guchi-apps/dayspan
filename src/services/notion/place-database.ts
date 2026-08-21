import type { Client } from "@notionhq/client";

// よく行く場所のデータソース。予定の「場所」欄の入力候補として読む（docs/spec.md §9）。
// タスク・日付リマインドと同じく、一次情報源はNotion側でDaySpanには保存しない。

export type PlaceField = "name" | "address" | "tags" | "coordinates";
export type PlacePropertyMap = Partial<Record<PlaceField, string>>;

type PropertyConfig = { id: string; name: string; type: string };
type Requirement = {
  field: PlaceField;
  label: string;
  types: string[];
  required: boolean;
  hints: string[];
  /**
   * 名前が当たったときだけ対応付ける項目。
   * 型だけで空いているプロパティへ割り当てると、住所と同じ `rich_text` を持つ
   * 「メモ」のような無関係な欄へ書き込んでしまうため、座標はこちらで扱う。
   */
  hintOnly?: boolean;
};

export const PLACE_FIELD_REQUIREMENTS: Requirement[] = [
  { field: "name", label: "名前", types: ["title"], required: true, hints: ["名前", "タイトル", "name", "title", "場所"] },
  { field: "address", label: "住所", types: ["rich_text"], required: false, hints: ["住所", "所在地", "address", "location"] },
  { field: "tags", label: "タグ", types: ["multi_select"], required: false, hints: ["タグ", "tag", "カテゴリ", "category", "種類"] },
  {
    field: "coordinates",
    label: "座標",
    types: ["rich_text"],
    required: false,
    hints: ["座標", "緯度", "経度", "coordinate", "latlng", "geo"],
    hintOnly: true,
  },
];

export type PlaceValidation = {
  propertyMap: PlacePropertyMap;
  missingRequired: { field: PlaceField; label: string; types: string[] }[];
  missingOptional: { field: PlaceField; label: string; types: string[] }[];
};

/**
 * 場所DBとして使えるかを検証し、アプリの項目名とNotionプロパティ名の対応を組み立てる。
 * 型の一致を主、名前の一致を従として推定するのはタスク・リマインドと同じ（task-database.ts）。
 */
export function buildPlacePropertyMap(properties: Record<string, PropertyConfig>): PlaceValidation {
  const entries = Object.values(properties);
  const used = new Set<string>();
  const propertyMap: PlacePropertyMap = {};
  const missingRequired: PlaceValidation["missingRequired"] = [];
  const missingOptional: PlaceValidation["missingOptional"] = [];
  const hinted = (property: PropertyConfig, requirement: Requirement) =>
    requirement.hints.some((hint) => property.name.toLowerCase().includes(hint.toLowerCase()));

  for (const requirement of PLACE_FIELD_REQUIREMENTS) {
    const property = entries.find(
      (entry) => requirement.types.includes(entry.type) && !used.has(entry.name) && hinted(entry, requirement),
    );
    if (property) {
      propertyMap[requirement.field] = property.name;
      used.add(property.name);
    }
  }
  for (const requirement of PLACE_FIELD_REQUIREMENTS) {
    if (propertyMap[requirement.field]) continue;
    const property = requirement.hintOnly
      ? undefined
      : entries.find((entry) => requirement.types.includes(entry.type) && !used.has(entry.name));
    if (property) {
      propertyMap[requirement.field] = property.name;
      used.add(property.name);
    } else {
      (requirement.required ? missingRequired : missingOptional).push({
        field: requirement.field,
        label: requirement.label,
        types: requirement.types,
      });
    }
  }
  return { propertyMap, missingRequired, missingOptional };
}

function plainTitle(items: Array<{ plain_text?: string }> | undefined): string {
  return items?.map((item) => item.plain_text ?? "").join("").trim() || "(無題)";
}

export async function validatePlaceDataSource(notion: Client, dataSourceId: string) {
  const source = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const validation = buildPlacePropertyMap(source.properties as Record<string, PropertyConfig>);
  if (!("title" in source)) return { ...validation, title: "(無題)", databaseId: null };
  const parent = source.database_parent;
  return {
    ...validation,
    title: plainTitle(source.title),
    databaseId: parent?.type === "database_id" ? parent.database_id : null,
  };
}

/** 新規作成する場所DBのプロパティ名。propertyMapの初期値もこの名前で確定させる。 */
export const PLACE_DATABASE_TEMPLATE = {
  name: "名前",
  address: "住所",
  tags: "タグ",
  coordinates: "座標",
} as const satisfies Required<Record<PlaceField, string>>;

/**
 * 必要なプロパティを揃えた場所DBを作成する。
 * タスクDBと同じく、設定画面で明示的に選んだときだけ実行する（docs/spec.md §9）。
 */
export async function createPlaceDatabase(
  notion: Client,
  { parentPageId, title }: { parentPageId: string; title: string },
): Promise<{ dataSourceId: string; databaseId: string; title: string; propertyMap: PlacePropertyMap }> {
  const database = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: title } }],
    initial_data_source: {
      properties: {
        [PLACE_DATABASE_TEMPLATE.name]: { title: {} },
        [PLACE_DATABASE_TEMPLATE.address]: { rich_text: {} },
        // タグの選択肢はユーザーが自由に増やすものなので、初期値は作らない。
        [PLACE_DATABASE_TEMPLATE.tags]: { multi_select: {} },
        // 地図から登録したときの緯度経度。`35.658034,139.701636` の形で入れる。
        [PLACE_DATABASE_TEMPLATE.coordinates]: { rich_text: {} },
      },
    },
  });

  if (!("data_sources" in database) || database.data_sources.length === 0) {
    throw new Error("Created database has no data source");
  }

  return {
    dataSourceId: database.data_sources[0].id,
    databaseId: database.id,
    title,
    propertyMap: { ...PLACE_DATABASE_TEMPLATE },
  };
}

/**
 * すでに使っている場所DBへ「座標」プロパティを足す。
 *
 * 地図からの登録（docs/spec.md §9）より前に作った場所DBには座標の置き場所が無い。
 * Notion側で手で足してDBを選び直させると、どの型で何という名前にすればよいのかが
 * 画面のどこにも出ていないため、設定画面から実行できるようにする。
 *
 * すでに同じ名前のプロパティがあるときは作らない。型が違っていても作り直さないのは、
 * 利用者が別の用途で使っている欄を黙って壊さないため。
 */
export async function addPlaceCoordinatesProperty(
  notion: Client,
  dataSourceId: string,
): Promise<PlaceValidation & { title: string; databaseId: string | null }> {
  const source = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const properties = source.properties as Record<string, PropertyConfig>;
  const existing = Object.values(properties).find(
    (property) => property.name === PLACE_DATABASE_TEMPLATE.coordinates,
  );

  if (!existing) {
    await notion.dataSources.update({
      data_source_id: dataSourceId,
      properties: { [PLACE_DATABASE_TEMPLATE.coordinates]: { rich_text: {} } } as never,
    });
  }

  // 足したあとの構成で対応付けを取り直す。作っただけでは propertyMap に載らない。
  return validatePlaceDataSource(notion, dataSourceId);
}
