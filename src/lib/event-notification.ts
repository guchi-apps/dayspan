/**
 * 予定ごとの通知設定（issue #708）に使う純粋なロジック。
 *
 * アカウント単位の設定（NotificationSetting）と、予定ごとの上書き（EventNotificationSetting）を
 * 合成して「実際に何分前に知らせるか」を決める。DB・外部APIを見ないため node:test でそのまま
 * 検証できる（services/notifications/plan.ts から呼ぶ）。
 */

import type { EventNotificationOverride } from "@/types/calendar";
import { EVENT_LEAD_MINUTES } from "@/types/notification";

/**
 * 許容される値だけを残し、重複を除いて昇順に並べる。
 *
 * 選択肢（EVENT_LEAD_MINUTES）に無い値が紛れ込むのは、DaySpanのAPIや将来のMCPから
 * 画面を経由せず直接呼ばれた場合。UIで絞っているだけの値をそのまま保存しない。
 */
export function normalizeLeadMinutes(input: number[]): number[] {
  const allowed = new Set<number>(EVENT_LEAD_MINUTES);
  const unique = new Set(input.filter((minutes) => allowed.has(minutes)));
  return [...unique].sort((a, b) => a - b);
}

/**
 * アカウント既定と予定ごとの上書きを合成し、実際に使う「何分前」の配列を返す。
 *
 * 上書きが無い予定はアカウント既定に従う（オフなら空配列）。上書きがある予定は、
 * enabled が false なら常に空配列（アカウント既定によらず通知しない）、true なら
 * その予定専用の leadMinutes をそのまま使う。
 */
export function resolveEventLeadMinutes(
  override: EventNotificationOverride | null,
  defaultEnabled: boolean,
  defaultLeadMinutes: number,
): number[] {
  if (override) return override.enabled ? override.leadMinutes : [];
  return defaultEnabled ? [defaultLeadMinutes] : [];
}

/** 「10分前」「1時間前」「ちょうど」のような表示用ラベル。 */
export function eventLeadLabel(minutes: number): string {
  if (minutes === 0) return "ちょうど";
  if (minutes < 60) return `${minutes}分前`;
  return `${minutes / 60}時間前`;
}
