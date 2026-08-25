import type { Client } from "@notionhq/client";
import type { NotionConnection } from "@prisma/client";

import { createNotionClient } from "./client";
import type { ReminderPropertyMap } from "./reminder-database";
import type { PropertyMap } from "./task-database";
import type { WorkPropertyMap } from "./work-database";

// タスクのタグ（multi_select）と日付リマインドの種類（select）の選択肢を扱う。
//
// 選択肢そのものはNotion側のプロパティ定義が一次情報源で、DaySpanのDBには持たない
// （docs/spec.md §19）。DaySpanからできるのは追加と削除だけ。既存の選択肢の名前と色は
// Notion APIが変更を受け付けないため（色は `Cannot update color of select with id: ...`、
// 名前はエラーにならず無視される）、変えたい場合はNotion側で直してもらう。

/** Notionのselect / multi_selectが取りうる色。DaySpanから指定できるのもこの10色に限る。 */
export const TAG_COLORS = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  default: "既定",
  gray: "グレー",
  brown: "ブラウン",
  orange: "オレンジ",
  yellow: "イエロー",
  green: "グリーン",
  blue: "ブルー",
  purple: "パープル",
  pink: "ピンク",
  red: "レッド",
};

export function isTagColor(value: unknown): value is TagColor {
  return typeof value === "string" && (TAG_COLORS as readonly string[]).includes(value);
}

export type TagOption = {
  /** Notion側の選択肢ID。更新時に既存の選択肢を指すために使う。 */
  id: string;
  name: string;
  color: TagColor;
};

/**
 * タグを置いているプロパティの種別。タスクは複数選択、リマインドの種類と勤務場所は単一選択。
 *
 * 勤務場所（docs/spec.md §34）をここへ含めるのは、選択肢と色がNotionのプロパティ定義そのもので、
 * 追加・削除の手順もタグとまったく同じため。別の経路を作ると、同じ操作が2か所に増える。
 */
export type TagKind = "task" | "reminder" | "work";

/**
 * 登録済みのタグ・種類。
 *
 * プロパティが無い（タスクDBにタグ列が無い等）場合と、1件も登録されていない場合は
 * 画面での案内が違うため、前者を null で区別する。
 */
export type TagCatalog = {
  task: TagOption[] | null;
  reminder: TagOption[] | null;
  work: TagOption[] | null;
};

export const EMPTY_TAG_CATALOG: TagCatalog = { task: null, reminder: null, work: null };

type PropertyConfig = {
  type?: string;
  select?: { options?: Array<{ id?: string; name?: string; color?: string }> };
  multi_select?: { options?: Array<{ id?: string; name?: string; color?: string }> };
};

/** タグの置き場所。データソースIDとプロパティ名が揃って初めて読み書きできる。 */
type TagLocation = { dataSourceId: string; propertyName: string };

export function tagLocation(connection: NotionConnection, kind: TagKind): TagLocation | null {
  if (kind === "task") {
    const propertyName = (connection.propertyMap as PropertyMap | null)?.tags;
    if (!connection.taskDataSourceId || !propertyName) return null;
    return { dataSourceId: connection.taskDataSourceId, propertyName };
  }

  if (kind === "work") {
    const propertyName = (connection.workPropertyMap as WorkPropertyMap | null)?.place;
    if (!connection.workDataSourceId || !propertyName) return null;
    return { dataSourceId: connection.workDataSourceId, propertyName };
  }

  const propertyName = (connection.reminderPropertyMap as ReminderPropertyMap | null)?.category;
  if (!connection.reminderDataSourceId || !propertyName) return null;
  return { dataSourceId: connection.reminderDataSourceId, propertyName };
}

function readOptions(property: PropertyConfig | undefined): TagOption[] | null {
  const options = property?.multi_select?.options ?? property?.select?.options;
  if (!options) return null;

  return options
    .filter((option): option is { id: string; name: string; color?: string } =>
      Boolean(option.id && option.name),
    )
    .map((option) => ({
      id: option.id,
      name: option.name,
      // Notion側で新しい色が増えても表示だけは壊さない。知らない色は既定として扱う。
      color: isTagColor(option.color) ? option.color : "default",
    }));
}

async function fetchOptions(
  notion: Client,
  { dataSourceId, propertyName }: TagLocation,
): Promise<TagOption[] | null> {
  const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const properties = dataSource.properties as Record<string, PropertyConfig>;
  return readOptions(properties[propertyName]);
}

/**
 * 1種類ぶんの選択肢だけを取得する。
 *
 * 勤務の画面では勤務場所しか要らない。まとめて取る `loadTagCatalog` を呼ぶと、使わない
 * タスクのタグと日付リマインドの種類のぶんまでNotionへ問い合わせることになる。
 */
export async function loadTagOptions(
  connection: NotionConnection | null,
  kind: TagKind,
): Promise<TagOption[] | null> {
  if (!connection) return null;
  const location = tagLocation(connection, kind);
  if (!location) return null;

  try {
    return await fetchOptions(createNotionClient(connection), location);
  } catch {
    // 選択肢は入力の候補でしかない。取れなくても画面は開けるようにする。
    return null;
  }
}

/**
 * 登録済みのタグ・種類をまとめて取得する。
 *
 * 取得に失敗しても画面自体は開けるようにする。タグは表示の彩りと入力の候補であって、
 * 予定・タスクを読むために要るものではないため、失敗は空として扱う。
 */
export async function loadTagCatalog(connection: NotionConnection | null): Promise<TagCatalog> {
  if (!connection) return EMPTY_TAG_CATALOG;

  const taskLocation = tagLocation(connection, "task");
  const reminderLocation = tagLocation(connection, "reminder");
  const workLocation = tagLocation(connection, "work");
  if (!taskLocation && !reminderLocation && !workLocation) return EMPTY_TAG_CATALOG;

  try {
    const notion = createNotionClient(connection);
    const [task, reminder, work] = await Promise.all([
      taskLocation ? fetchOptions(notion, taskLocation) : null,
      reminderLocation ? fetchOptions(notion, reminderLocation) : null,
      workLocation ? fetchOptions(notion, workLocation) : null,
    ]);
    return { task, reminder, work };
  } catch {
    return EMPTY_TAG_CATALOG;
  }
}

/**
 * 選択肢の一覧をNotionへ書き戻す。
 *
 * Notionは配列に無い選択肢を削除するため、残すものは必ずIDで送り直す。
 * 名前や色を添えて送っても既存の選択肢には反映されない（無視される・エラーになる）ので、
 * 残す選択肢はIDだけにして、変更のつもりが削除と再作成にならないようにする。
 */
async function writeOptions(
  notion: Client,
  { dataSourceId, propertyName }: TagLocation,
  kind: TagKind,
  options: Array<{ id: string } | { name: string; color: TagColor }>,
): Promise<void> {
  const config = kind === "task" ? { multi_select: { options } } : { select: { options } };

  await notion.dataSources.update({
    data_source_id: dataSourceId,
    properties: { [propertyName]: config } as never,
  });
}

/** 選択肢を1つ追加する。すでに同じ名前があれば何もしない。 */
export async function addTagOption(
  connection: NotionConnection,
  kind: TagKind,
  name: string,
  color: TagColor,
): Promise<TagOption[]> {
  const location = tagLocation(connection, kind);
  if (!location) throw new Error("Tag property is not configured");

  const notion = createNotionClient(connection);
  const current = (await fetchOptions(notion, location)) ?? [];
  if (current.some((option) => option.name === name)) return current;

  await writeOptions(notion, location, kind, [
    ...current.map((option) => ({ id: option.id })),
    { name, color },
  ]);

  return (await fetchOptions(notion, location)) ?? [];
}

/**
 * 選択肢を1つ削除する。
 *
 * Notionでは選択肢を消すと、それが付いていた既存ページからも外れる。取り消せないため、
 * 呼び出し側（設定画面）でその旨を伝えたうえで実行する。
 */
export async function removeTagOption(
  connection: NotionConnection,
  kind: TagKind,
  name: string,
): Promise<TagOption[]> {
  const location = tagLocation(connection, kind);
  if (!location) throw new Error("Tag property is not configured");

  const notion = createNotionClient(connection);
  const current = (await fetchOptions(notion, location)) ?? [];

  await writeOptions(
    notion,
    location,
    kind,
    current.filter((option) => option.name !== name).map((option) => ({ id: option.id })),
  );

  return (await fetchOptions(notion, location)) ?? [];
}
