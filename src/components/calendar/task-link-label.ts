import {
  TASK_EVENT_STAGE_LABELS,
  TASK_LINK_TARGET_LABELS,
  type TaskEventLinkItem,
  type TaskItem,
} from "@/types/calendar";

import type { TaskDateField } from "./item-layout";

/**
 * 紐づけの表示ラベル（docs/spec.md §31）。
 *
 * 予定名を含む形と段階だけの形を分けて持つ。カレンダーの枠には予定名まで入らず、
 * その予定のすぐ隣に置かれるため段階だけで足りる。一覧・詳細では、どの予定なのかが
 * 画面のどこにも出ていないため予定名から出す。
 *
 * 行き先（期限・予定日）を添えるかどうかも置く場所で分かれる。カレンダーの枠は実線・破線で
 * どちらの日付かがすでに分かれており、行き先まで書くと項目名の幅をその分奪う。
 */

/** 「終了後」。カレンダーの枠に添える短い形。 */
export function taskLinkStageLabel(link: TaskEventLinkItem): string {
  return TASK_EVENT_STAGE_LABELS[link.stage];
}

/** 「定例会議 の終了後」。一覧の行・詳細画面で使う。 */
export function taskLinkFullLabel(link: TaskEventLinkItem): string {
  return `${link.eventTitle} の${TASK_EVENT_STAGE_LABELS[link.stage]}`;
}

/** 「期限」「予定日」。1つのタスクに2件並びうるため、どちらの日付の話かを示す。 */
export function taskLinkTargetLabel(link: TaskEventLinkItem): string {
  return TASK_LINK_TARGET_LABELS[link.target];
}

/** 「期限: 定例会議 の開始まで」。日付が画面に出ていない・2件並ぶ場所で使う。 */
export function taskLinkTargetedLabel(link: TaskEventLinkItem): string {
  return `${TASK_LINK_TARGET_LABELS[link.target]}: ${taskLinkFullLabel(link)}`;
}

/**
 * 紐づけから決まる日時の表示。日付のみは日付を、時刻ありは日付と時刻を並べる。
 *
 * 日付・時刻の解釈は設定タイムゾーンで固定する。実行環境のローカル時刻に依存させると、
 * サーバー（UTC）とブラウザ（JST）で結果がずれ、ハイドレーションが一致しない。
 */
export function formatLinkedDate(date: string, timeZone: string): string {
  if (!date.includes("T")) {
    return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
  }

  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(date));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("month")}月${get("day")}日 ${get("hour")}:${get("minute")}`;
}

/**
 * その枠（期限・予定日）を決めている紐づけ（docs/spec.md §31）。
 *
 * カレンダーには1つのタスクが期限と予定日の2枠で現れ、紐づけもその行き先ごとに持てる。
 * 枠と紐づけの行き先が合っているものだけを印にしないと、期限の枠に予定日の紐づけの段階が
 * 出て、動かない日付に「終了後」と添えられる。
 */
export function taskLinkForField(
  task: Pick<TaskItem, "links">,
  field: TaskDateField,
): TaskEventLinkItem | null {
  const target = field === "planned" ? "PLANNED" : "DUE";
  return task.links.find((link) => link.target === target) ?? null;
}
