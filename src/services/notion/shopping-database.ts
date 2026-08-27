import type { Client } from "@notionhq/client";

// 買い物リストのデータソース（docs/spec.md §36）。
//
// shopping-list（別アプリ）が読み書きしているDBと同じプロパティ構成にする。同じDBを選べば、
// どちらのアプリから足したものも両方に出る。タスク・日付リマインド・場所・勤務と同じく、
// 一次情報源はNotion側でDaySpanのDBには保存しない。

export type ShoppingField = "title" | "category" | "memo" | "priority" | "bought";

export type ShoppingPropertyMap = Partial<Record<ShoppingField, string>>;

type PropertyConfig = { id: string; name: string; type: string };
type Requirement = {
  field: ShoppingField;
  label: string;
  types: string[];
  required: boolean;
  hints: string[];
  /**
   * 名前が当たったときだけ対応付ける項目（勤務記録DBの出張・年休と同じ扱い）。
   *
   * カテゴリと優先度はどちらも select で、型だけを見て空いている欄へ順に割り当てると
   * 入れ替わりうる。入れ替わると「高・中・低」がカテゴリのタブとして並び、買い物の
   * カテゴリが優先度の帯の色を決めることになる。推測では割り当てない。
   */
  hintOnly?: boolean;
};

export const SHOPPING_FIELD_REQUIREMENTS: Requirement[] = [
  {
    field: "title",
    label: "項目",
    types: ["title"],
    required: true,
    hints: ["項目", "名前", "アイテム", "title", "name", "item"],
  },
  {
    field: "category",
    label: "カテゴリ",
    types: ["select"],
    required: false,
    hints: ["カテゴリ", "カテゴリー", "分類", "売り場", "category", "label", "ラベル"],
    hintOnly: true,
  },
  {
    field: "memo",
    label: "メモ",
    types: ["rich_text"],
    required: false,
    hints: ["メモ", "備考", "数量", "memo", "note"],
  },
  {
    field: "priority",
    label: "優先度",
    types: ["select"],
    required: false,
    hints: ["優先度", "優先", "priority"],
    hintOnly: true,
  },
  {
    field: "bought",
    label: "購入済み",
    types: ["checkbox"],
    required: false,
    hints: ["購入済み", "購入", "買った", "完了", "done", "bought", "checked"],
  },
];

export type ShoppingValidation = {
  propertyMap: ShoppingPropertyMap;
  missingRequired: { field: ShoppingField; label: string; types: string[] }[];
  missingOptional: { field: ShoppingField; label: string; types: string[] }[];
};

/**
 * 買い物リストDBとして使えるかを検証し、アプリの項目名とNotionプロパティ名の対応を組み立てる。
 * 型の一致を主、名前の一致を従として推定するのはタスク・リマインド・場所・勤務と同じ。
 */
export function buildShoppingPropertyMap(
  properties: Record<string, PropertyConfig>,
): ShoppingValidation {
  const entries = Object.values(properties);
  const used = new Set<string>();
  const propertyMap: ShoppingPropertyMap = {};
  const missingRequired: ShoppingValidation["missingRequired"] = [];
  const missingOptional: ShoppingValidation["missingOptional"] = [];
  const hinted = (property: PropertyConfig, requirement: Requirement) =>
    requirement.hints.some((hint) => property.name.toLowerCase().includes(hint.toLowerCase()));

  for (const requirement of SHOPPING_FIELD_REQUIREMENTS) {
    const property = entries.find(
      (entry) =>
        requirement.types.includes(entry.type) && !used.has(entry.name) && hinted(entry, requirement),
    );
    if (property) {
      propertyMap[requirement.field] = property.name;
      used.add(property.name);
    }
  }

  for (const requirement of SHOPPING_FIELD_REQUIREMENTS) {
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

export async function validateShoppingDataSource(notion: Client, dataSourceId: string) {
  const source = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const validation = buildShoppingPropertyMap(source.properties as Record<string, PropertyConfig>);
  if (!("title" in source)) return { ...validation, title: "(無題)", databaseId: null };
  const parent = source.database_parent;
  return {
    ...validation,
    title: plainTitle(source.title),
    databaseId: parent?.type === "database_id" ? parent.database_id : null,
  };
}

/** 新規作成する買い物リストDBのプロパティ名。propertyMapの初期値もこの名前で確定させる。 */
export const SHOPPING_DATABASE_TEMPLATE = {
  title: "項目",
  category: "カテゴリ",
  memo: "メモ",
  priority: "優先度",
  bought: "購入済み",
} as const satisfies Required<Record<ShoppingField, string>>;

/**
 * カテゴリの初期の選択肢。
 *
 * 空のselectから始めると、カテゴリを1つ足すまで一覧が「その他」だけになる。よくある売り場を
 * 入れておき、要らないものは設定（タグ）から消してもらう。色はNotionの既定の10色から選ぶ。
 */
const DEFAULT_CATEGORY_OPTIONS = [
  { name: "食品", color: "green" },
  { name: "日用品", color: "blue" },
  { name: "薬・その他", color: "orange" },
] as const;

/**
 * 優先度の選択肢。
 *
 * 選択肢はDaySpanが決める。カテゴリと違って利用者が足すものではなく、行左端の帯の色と
 * 優先度順の並びがこの名前で決まるため（`src/types/shopping.ts`）。タスクの優先度とも
 * 名前を揃える（同じアプリの中で同じ意味の言葉が食い違わないようにする）。
 */
export const SHOPPING_PRIORITY_OPTIONS = [
  { name: "高", color: "red" },
  { name: "中", color: "yellow" },
  { name: "低", color: "gray" },
] as const;

/**
 * 必要なプロパティを揃えた買い物リストDBを作成する。
 *
 * カテゴリと優先度は名前が当たったときだけ対応付ける（hintOnly）ため、既存のDBを選んでもらう
 * 経路では揃わないことがある。ここで作れば必ず揃った構成になる。
 */
export async function createShoppingDatabase(
  notion: Client,
  { parentPageId, title }: { parentPageId: string; title: string },
): Promise<{
  dataSourceId: string;
  databaseId: string;
  title: string;
  propertyMap: ShoppingPropertyMap;
}> {
  const database = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: title } }],
    initial_data_source: {
      properties: {
        [SHOPPING_DATABASE_TEMPLATE.title]: { title: {} },
        [SHOPPING_DATABASE_TEMPLATE.category]: {
          select: { options: DEFAULT_CATEGORY_OPTIONS.map((option) => ({ ...option })) },
        },
        [SHOPPING_DATABASE_TEMPLATE.memo]: { rich_text: {} },
        [SHOPPING_DATABASE_TEMPLATE.priority]: {
          select: { options: SHOPPING_PRIORITY_OPTIONS.map((option) => ({ ...option })) },
        },
        [SHOPPING_DATABASE_TEMPLATE.bought]: { checkbox: {} },
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
    propertyMap: { ...SHOPPING_DATABASE_TEMPLATE },
  };
}
