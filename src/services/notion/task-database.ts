import type { Client } from "@notionhq/client";

// Notion API 2025-09-03以降、プロパティを持つのはデータベースではなくデータソース。
// タスクの読み書きはデータソースに対して行う（docs/spec.md §9）。

export type TaskField =
  | "title"
  | "due"
  | "done"
  | "memo"
  | "priority"
  | "recurrence"
  | "tags";

type FieldRequirement = {
  field: TaskField;
  label: string;
  types: string[];
  required: boolean;
  /** プロパティ名の自動推定に使う候補。ユーザーが別名を付けていても拾えるようにする。 */
  nameHints: string[];
};

export const TASK_FIELD_REQUIREMENTS: FieldRequirement[] = [
  { field: "title", label: "タイトル", types: ["title"], required: true, nameHints: ["タイトル", "名前", "title", "name", "タスク"] },
  { field: "due", label: "期限", types: ["date"], required: true, nameHints: ["期限", "締切", "日付", "due", "date", "deadline"] },
  { field: "done", label: "完了状態", types: ["checkbox", "status"], required: true, nameHints: ["完了", "done", "status", "ステータス", "済"] },
  { field: "memo", label: "メモ", types: ["rich_text"], required: false, nameHints: ["メモ", "備考", "memo", "note", "notes", "詳細"] },
  { field: "priority", label: "優先度", types: ["select", "status"], required: false, nameHints: ["優先度", "priority", "重要度"] },
  { field: "recurrence", label: "繰り返し", types: ["select"], required: false, nameHints: ["繰り返し", "repeat", "recurrence", "リピート"] },
  { field: "tags", label: "タグ", types: ["multi_select"], required: false, nameHints: ["タグ", "tag", "tags", "カテゴリ", "category"] },
];

export type PropertyMap = Partial<Record<TaskField, string>>;

export type ValidationResult = {
  propertyMap: PropertyMap;
  missingRequired: { field: TaskField; label: string; types: string[] }[];
  missingOptional: { field: TaskField; label: string; types: string[] }[];
};

type NotionPropertyConfig = { id: string; name: string; type: string };

export type DataSourceSummary = {
  dataSourceId: string;
  databaseId: string | null;
  title: string;
  url: string | null;
};

function plainTitle(richText: Array<{ plain_text?: string }> | undefined): string {
  if (!richText || richText.length === 0) return "(無題)";
  return richText.map((t) => t.plain_text ?? "").join("").trim() || "(無題)";
}

/** Integrationに共有されているデータソース（＝タスクDBの候補）を列挙する。 */
export async function listCandidateDataSources(notion: Client): Promise<DataSourceSummary[]> {
  const summaries: DataSourceSummary[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.search({
      filter: { property: "object", value: "data_source" },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });

    for (const result of response.results) {
      if (result.object !== "data_source") continue;
      // 検索結果には最小限のフィールドしか含まれない場合がある。title等が無いものは詳細を持たない
      // 部分レスポンスなので、一覧としては表示できるものだけを拾う。
      if (!("title" in result)) continue;

      const parent = result.database_parent;
      summaries.push({
        dataSourceId: result.id,
        databaseId: parent && parent.type === "database_id" ? parent.database_id : null,
        title: plainTitle(result.title),
        url: result.url ?? null,
      });
    }

    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (cursor);

  return summaries;
}

/**
 * タスクDBとして使えるかを検証し、アプリの項目名とNotionプロパティ名の対応を組み立てる。
 * プロパティ名はユーザーが自由に付けられるため、型の一致を主、名前の一致を従として推定する。
 */
export function buildPropertyMap(
  properties: Record<string, NotionPropertyConfig>,
): ValidationResult {
  const entries = Object.values(properties);
  const used = new Set<string>();
  const propertyMap: PropertyMap = {};
  const missingRequired: ValidationResult["missingRequired"] = [];
  const missingOptional: ValidationResult["missingOptional"] = [];

  const matchesHints = (property: NotionPropertyConfig, requirement: FieldRequirement) =>
    requirement.nameHints.some((hint) =>
      property.name.toLowerCase().includes(hint.toLowerCase()),
    );

  // 1巡目: 名前が想定に近いものを先に確定させる。型だけで先着順に割り当てると、
  // 例えば優先度が無いDBで「繰り返し」（同じselect型）を優先度として取り違えてしまう。
  for (const requirement of TASK_FIELD_REQUIREMENTS) {
    const chosen = entries.find(
      (p) => requirement.types.includes(p.type) && !used.has(p.name) && matchesHints(p, requirement),
    );
    if (chosen) {
      propertyMap[requirement.field] = chosen.name;
      used.add(chosen.name);
    }
  }

  // 2巡目: 名前では決まらなかった項目を型で補う。ただし、他の項目の想定名に一致する
  // プロパティは、その項目のために空けておく（取り違えを避ける）。
  for (const requirement of TASK_FIELD_REQUIREMENTS) {
    if (propertyMap[requirement.field]) continue;

    const chosen = entries.find(
      (p) =>
        requirement.types.includes(p.type) &&
        !used.has(p.name) &&
        !TASK_FIELD_REQUIREMENTS.some(
          (other) => other.field !== requirement.field && matchesHints(p, other),
        ),
    );

    if (chosen) {
      propertyMap[requirement.field] = chosen.name;
      used.add(chosen.name);
      continue;
    }

    const missing = {
      field: requirement.field,
      label: requirement.label,
      types: requirement.types,
    };
    if (requirement.required) {
      missingRequired.push(missing);
    } else {
      missingOptional.push(missing);
    }
  }

  return { propertyMap, missingRequired, missingOptional };
}

export async function validateTaskDataSource(
  notion: Client,
  dataSourceId: string,
): Promise<ValidationResult & { title: string; databaseId: string | null }> {
  const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId });

  const properties = dataSource.properties as Record<string, NotionPropertyConfig>;

  // レスポンスは詳細版と部分版のユニオン。titleの有無で詳細版かを判定する。
  if (!("title" in dataSource)) {
    return { ...buildPropertyMap(properties), title: "(無題)", databaseId: null };
  }

  const parent = dataSource.database_parent;

  return {
    ...buildPropertyMap(properties),
    title: plainTitle(dataSource.title),
    databaseId: parent && parent.type === "database_id" ? parent.database_id : null,
  };
}

// --- タスクDBの新規作成 ---
// 仕様上、DaySpanが無断でNotion DBを作ることはしない。ユーザーが設定画面で明示的に
// 「新規作成」を選んだときだけこの経路を通る（docs/spec.md §9）。

/** 新規作成するタスクDBのプロパティ名。propertyMapの初期値もこの名前で確定させる。 */
export const TASK_DATABASE_TEMPLATE = {
  title: "タイトル",
  due: "期限",
  done: "完了",
  memo: "メモ",
  priority: "優先度",
  recurrence: "繰り返し",
  tags: "タグ",
} as const satisfies Required<Record<TaskField, string>>;

export const PRIORITY_OPTIONS = ["高", "中", "低"];
export const RECURRENCE_OPTIONS = ["なし", "毎日", "毎週", "毎月", "毎年"];

export type SharedPageSummary = {
  pageId: string;
  title: string;
};

function pageTitle(page: PageObjectResponseLike): string {
  const titleProperty = Object.values(page.properties ?? {}).find(
    (property) => property?.type === "title",
  );
  if (!titleProperty || !Array.isArray(titleProperty.title)) return "(無題)";
  return titleProperty.title.map((t) => t.plain_text ?? "").join("").trim() || "(無題)";
}

type PageObjectResponseLike = {
  properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }>;
};

/** タスクDBの作成先として選べるページ（Connectionに共有されているページ）を列挙する。 */
export async function listSharedPages(notion: Client): Promise<SharedPageSummary[]> {
  const pages: SharedPageSummary[] = [];
  let cursor: string | undefined;

  do {
    const response = await notion.search({
      filter: { property: "object", value: "page" },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });

    for (const result of response.results) {
      if (result.object !== "page") continue;
      // データベース内のページ（＝レコード）は作成先にできないため除く。
      if ("parent" in result && result.parent?.type === "data_source_id") continue;
      if (!("properties" in result)) continue;

      pages.push({ pageId: result.id, title: pageTitle(result) });
    }

    cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
  } while (cursor);

  return pages;
}

/**
 * 必要なプロパティを揃えたタスクDBを作成し、そのデータソースIDを返す。
 * プロパティ名はテンプレートで固定するため、検証を通さずpropertyMapを確定できる。
 */
export async function createTaskDatabase(
  notion: Client,
  { parentPageId, title }: { parentPageId: string; title: string },
): Promise<{ dataSourceId: string; databaseId: string; title: string; propertyMap: PropertyMap }> {
  const database = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId },
    title: [{ type: "text", text: { content: title } }],
    initial_data_source: {
      properties: {
        [TASK_DATABASE_TEMPLATE.title]: { title: {} },
        [TASK_DATABASE_TEMPLATE.due]: { date: {} },
        [TASK_DATABASE_TEMPLATE.done]: { checkbox: {} },
        [TASK_DATABASE_TEMPLATE.memo]: { rich_text: {} },
        [TASK_DATABASE_TEMPLATE.priority]: {
          select: { options: PRIORITY_OPTIONS.map((name) => ({ name })) },
        },
        [TASK_DATABASE_TEMPLATE.recurrence]: {
          select: { options: RECURRENCE_OPTIONS.map((name) => ({ name })) },
        },
        // タグの選択肢はユーザーが自由に増やすものなので、初期値は作らない。
        [TASK_DATABASE_TEMPLATE.tags]: { multi_select: {} },
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
    propertyMap: { ...TASK_DATABASE_TEMPLATE },
  };
}
