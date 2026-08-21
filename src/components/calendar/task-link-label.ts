import { TASK_EVENT_STAGE_LABELS, type TaskEventLinkItem } from "@/types/calendar";

/**
 * 紐づけの表示ラベル（docs/spec.md §31）。
 *
 * 予定名を含む形と段階だけの形を分けて持つ。カレンダーの枠には予定名まで入らず、
 * その予定のすぐ隣に置かれるため段階だけで足りる。一覧・詳細では、どの予定なのかが
 * 画面のどこにも出ていないため予定名から出す。
 */

/** 「終了後」。カレンダーの枠に添える短い形。 */
export function taskLinkStageLabel(link: TaskEventLinkItem): string {
  return TASK_EVENT_STAGE_LABELS[link.stage];
}

/** 「定例会議 の終了後」。一覧の行・詳細画面で使う。 */
export function taskLinkFullLabel(link: TaskEventLinkItem): string {
  return `${link.eventTitle} の${TASK_EVENT_STAGE_LABELS[link.stage]}`;
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
