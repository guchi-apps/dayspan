import type { Client } from "@notionhq/client";

export type ReminderField = "title" | "date" | "category" | "memo" | "annual";
export type ReminderPropertyMap = Partial<Record<ReminderField, string>>;

type PropertyConfig = { id: string; name: string; type: string };
type Requirement = {
  field: ReminderField;
  label: string;
  types: string[];
  required: boolean;
  hints: string[];
};

export const REMINDER_FIELD_REQUIREMENTS: Requirement[] = [
  { field: "title", label: "タイトル", types: ["title"], required: true, hints: ["タイトル", "名前", "title", "name", "リマインド"] },
  { field: "date", label: "日付", types: ["date"], required: true, hints: ["日付", "対象日", "date", "更新日", "記念日"] },
  { field: "category", label: "種類", types: ["select"], required: false, hints: ["種類", "カテゴリ", "category", "type"] },
  { field: "memo", label: "メモ", types: ["rich_text"], required: false, hints: ["メモ", "備考", "memo", "note"] },
  { field: "annual", label: "毎年", types: ["checkbox"], required: false, hints: ["毎年", "annual", "繰り返し", "recurring", "repeat"] },
];

/**
 * ゴミの日DB（docs/spec.md §9）が使う項目。日付リマインドDBから「毎年」を除いたもの。
 * myroomは収集日ごとに1ページを書き出すため、毎年の繰り返しは持たない。
 * 検証そのものは日付リマインドDBと同じ（毎年は任意項目なので、無くても接続できる）。
 */
export const GARBAGE_FIELD_REQUIREMENTS = REMINDER_FIELD_REQUIREMENTS.filter(
  (requirement) => requirement.field !== "annual",
);

export type ReminderValidation = {
  propertyMap: ReminderPropertyMap;
  missingRequired: { field: ReminderField; label: string; types: string[] }[];
  missingOptional: { field: ReminderField; label: string; types: string[] }[];
};

export function buildReminderPropertyMap(properties: Record<string, PropertyConfig>): ReminderValidation {
  const entries = Object.values(properties);
  const used = new Set<string>();
  const propertyMap: ReminderPropertyMap = {};
  const missingRequired: ReminderValidation["missingRequired"] = [];
  const missingOptional: ReminderValidation["missingOptional"] = [];
  const hinted = (property: PropertyConfig, requirement: Requirement) =>
    requirement.hints.some((hint) => property.name.toLowerCase().includes(hint.toLowerCase()));

  for (const requirement of REMINDER_FIELD_REQUIREMENTS) {
    const property = entries.find((entry) => requirement.types.includes(entry.type) && !used.has(entry.name) && hinted(entry, requirement));
    if (property) {
      propertyMap[requirement.field] = property.name;
      used.add(property.name);
    }
  }
  for (const requirement of REMINDER_FIELD_REQUIREMENTS) {
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

export async function validateReminderDataSource(notion: Client, dataSourceId: string) {
  const source = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const validation = buildReminderPropertyMap(source.properties as Record<string, PropertyConfig>);
  if (!("title" in source)) return { ...validation, title: "(無題)", databaseId: null };
  const parent = source.database_parent;
  return {
    ...validation,
    title: plainTitle(source.title),
    databaseId: parent?.type === "database_id" ? parent.database_id : null,
  };
}
