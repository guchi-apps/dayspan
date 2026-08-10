import type { Client } from "@notionhq/client";

// よく行く場所のデータソース。予定の「場所」欄の入力候補として読む（docs/spec.md §9）。
// タスク・日付リマインドと同じく、一次情報源はNotion側でDaySpanには保存しない。

export type PlaceField = "name" | "address" | "tags";
export type PlacePropertyMap = Partial<Record<PlaceField, string>>;

type PropertyConfig = { id: string; name: string; type: string };
type Requirement = {
  field: PlaceField;
  label: string;
  types: string[];
  required: boolean;
  hints: string[];
};

export const PLACE_FIELD_REQUIREMENTS: Requirement[] = [
  { field: "name", label: "名前", types: ["title"], required: true, hints: ["名前", "タイトル", "name", "title", "場所"] },
  { field: "address", label: "住所", types: ["rich_text"], required: false, hints: ["住所", "所在地", "address", "location"] },
  { field: "tags", label: "タグ", types: ["multi_select"], required: false, hints: ["タグ", "tag", "カテゴリ", "category", "種類"] },
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
    const property = entries.find((entry) => requirement.types.includes(entry.type) && !used.has(entry.name));
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
