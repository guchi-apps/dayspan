import { japaneseHolidayName } from "@/lib/japanese-holidays";
import { weekdayOf } from "@/lib/work-days";

/**
 * 日付に当てる文字色（issue #413）。
 *
 * 日曜と祝日は赤、土曜は青。見ているのは曜日そのものではなく「その日が働く日かどうか」で、
 * 月曜の祝日が平日と同じ色だと、カレンダーの数字からはその日が休みだと読めない。
 *
 * カレンダー画面と勤務の画面の日別一覧が同じ規則で塗るため、`src/components/calendar/` では
 * なくここに置く（issue #582）。勤務の画面は自前の写しで別のロール（`error` / `travel`）を
 * 当てており、`--color-error` が `@theme` に無いせいで日曜・祝日にだけ色が付いていなかった。
 * 写しを持つと、片方だけを直したときに同じ日が画面によって違う色になる（`isAutoOffDay()` を
 * `work-days.ts` へ置いたのと同じ理由）。
 *
 * 彩度は落としてある。日付の数字は予定の帯と同じ面に並ぶため、はっきりした赤・青にすると
 * 予定の色より前へ出る。勤務の画面では未対応の手続き（`error`）が強い赤を持っており、そちらと
 * 「その日は休み」の赤が同じ強さで並ばない、という役割の分かれ方にもなる。
 *
 * 曜日の見出し（月表示の7列）は特定の日ではなく曜日そのものを指すため、そちらは
 * `weekdayOnlyTone()` で日曜・土曜だけから決める。
 */

/**
 * 休みの側の色。日曜・祝日の日付のほか、勤務の画面では祝日名と「休み」の行にも当てる
 * （issue #582。行の文字が赤でないと、その日が休みだと日付の色からしか読めない）。
 */
export const OFF_DAY_TONE = "text-rose-700/80 dark:text-rose-300/80";

const SATURDAY_TONE = "text-sky-700/80 dark:text-sky-300/80";

/** その日の色。色を変えない日は null（呼ぶ側が既定の色を当てる）。 */
export function dayTone(dateKey: string): string | null {
  const day = weekdayOf(dateKey);
  if (day === 0 || japaneseHolidayName(dateKey)) return OFF_DAY_TONE;
  if (day === 6) return SATURDAY_TONE;
  return null;
}

/** 曜日そのものの色。日付を持たない見出し行に使う。 */
export function weekdayOnlyTone(weekday: number): string | null {
  if (weekday === 0) return OFF_DAY_TONE;
  if (weekday === 6) return SATURDAY_TONE;
  return null;
}

export function weekdayLabel(dateKey: string): string {
  const labels = ["日", "月", "火", "水", "木", "金", "土"];
  return labels[weekdayOf(dateKey)];
}
