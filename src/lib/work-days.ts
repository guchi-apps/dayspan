import { japaneseHolidayName } from "@/lib/japanese-holidays";

/**
 * 勤務の記録で「その日が働く日かどうか」を決める（docs/spec.md §34）。
 *
 * 勤務の画面（登録が無い日の表記）と年休の日数えの両方が同じ判定を使うため、画面の中では
 * なくここに置く。写しを持つと、片方だけを直したときに、画面に「休み」と出ている日が
 * 年休の日数には数えられている、という食い違いが起きる。
 */

/** YYYY-MM-DD の曜日。UTCで組み立てて、実行環境のローカル時刻に依存させない。 */
export function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

/**
 * 登録が無い日を自動的に「休み」として扱ってよいか。
 *
 * 土曜・日曜・祝日が対象。日曜・祝日を同じ赤で示している理由（月曜の祝日が平日と同じ色だと、
 * 入れ忘れなのかそもそも働いていない日なのか読めない）が、そのまま「未登録」と「休み」の
 * どちらを出すかにも当てはまるため、色分けと対象をそろえる。
 */
export function isAutoOffDay(dateKey: string): boolean {
  const day = weekdayOf(dateKey);
  return day === 0 || day === 6 || japaneseHolidayName(dateKey) !== null;
}
