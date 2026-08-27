import { japaneseHolidayName } from "@/lib/japanese-holidays";

/**
 * カレンダーに出す日付の文字色（issue #413）。
 *
 * 日曜と祝日は赤、土曜は青。見ているのは曜日そのものではなく「その日が働く日かどうか」で、
 * 月曜の祝日が平日と同じ色だと、カレンダーの数字からはその日が休みだと読めない
 * （勤務の画面の日別一覧が先に同じ決めで塗られている・docs/spec.md §34）。
 *
 * 彩度は落としてある。日付の数字は予定の帯と同じ面に並ぶため、はっきりした赤・青にすると
 * 予定の色より前へ出る。
 *
 * 曜日の見出し（月表示の7列）は特定の日ではなく曜日そのものを指すため、そちらは
 * `weekdayOnlyTone()` で日曜・土曜だけから決める。
 */

const SUNDAY_TONE = "text-rose-700/80 dark:text-rose-300/80";
const SATURDAY_TONE = "text-sky-700/80 dark:text-sky-300/80";

/** その日の色。色を変えない日は null（呼ぶ側が既定の色を当てる）。 */
export function dayTone(dateKey: string): string | null {
  const day = weekdayOf(dateKey);
  if (day === 0 || japaneseHolidayName(dateKey)) return SUNDAY_TONE;
  if (day === 6) return SATURDAY_TONE;
  return null;
}

/** 曜日そのものの色。日付を持たない見出し行に使う。 */
export function weekdayOnlyTone(weekday: number): string | null {
  if (weekday === 0) return SUNDAY_TONE;
  if (weekday === 6) return SATURDAY_TONE;
  return null;
}

export function weekdayLabel(dateKey: string): string {
  const labels = ["日", "月", "火", "水", "木", "金", "土"];
  return labels[weekdayOf(dateKey)];
}

/** 正午のUTCで読む。実行環境のローカル時刻に依存させないため（docs/spec.md §5）。 */
function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}
