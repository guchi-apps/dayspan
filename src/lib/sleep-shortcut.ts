/**
 * ヘルスケアから取り込む睡眠の時間帯の判定（docs/spec.md §40）。
 *
 * DB・外部APIには触れない純粋な計算にしてある（`lib/sleep.ts` と同じ立ち位置）。
 */

/** 記録として受け付ける長さの上限（分）。1回の睡眠が24時間を超えることはない。 */
export const MAX_SLEEP_MINUTES = 24 * 60;

/** 時間帯（ミリ秒）。重なりの判定に使う。 */
export type SleepSpan = { start: number; end: number };

/**
 * すでにある睡眠のうち、送られてきた時間帯と重なる最初のものを返す。無ければ null。
 *
 * オートメーションは条件が揃えば何度でも走る。同じ夜の睡眠が2件並ぶと、
 * `/activity/sleep` の平均も目標に届かなかった夜の数も倍で出る（docs/spec.md §39）。
 *
 * 真偽ではなく重なった相手を返すのは、応答のメッセージに「いつの睡眠と重なったのか」を
 * 出すため。呼び出し側で探し直すと、重なりの規則が2か所に分かれる。
 *
 * 半開区間で見る。前の睡眠の終わりと次の始まりがちょうど同じ時刻（連続して2回に分けて
 * 記録した夜）は重なりにしない。
 */
export function findOverlappingSleepSpan<T extends SleepSpan>(
  range: SleepSpan,
  spans: T[],
): T | null {
  return spans.find((span) => span.start < range.end && range.start < span.end) ?? null;
}
