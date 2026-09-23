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
 * 予定ごとの設定（issue #746でオプトイン式へ変更）から、実際に使う「何分前」の配列を返す。
 *
 * 予定は既定では通知しない。通知を入れた予定（enabled な上書きがある予定）だけが対象で、
 * 上書きが無い・enabled が false の予定は常に空配列。アカウント全体の予定通知
 * （accountEnabled）は親スイッチとして残し、オフの間は入れた予定も通知しない。
 */
export function resolveEventLeadMinutes(
  override: EventNotificationOverride | null,
  accountEnabled: boolean,
): number[] {
  if (!accountEnabled || !override?.enabled) return [];
  return override.leadMinutes;
}

/** 「10分前」「1時間前」「ちょうど」のような表示用ラベル。 */
export function eventLeadLabel(minutes: number): string {
  if (minutes === 0) return "ちょうど";
  if (minutes < 60) return `${minutes}分前`;
  return `${minutes / 60}時間前`;
}
