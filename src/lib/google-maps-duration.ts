/**
 * Googleマップの経路画面からコピーした文字列から、所要分数を読む（docs/spec.md §29）。
 *
 * 「1 時間 5 分」「25 分」「1時間」「1 hr 5 min」「45 min」を受ける。複数あれば先頭の値
 * （Googleマップは最速の経路を先頭に出す）。読めなければ null で、何も書き換えない。
 */

const HOURS = /(\d+)\s*(?:時間|hours?|hrs?|h)(?![a-z])/i;
const MINUTES = /(\d+)\s*(?:分|minutes?|mins?|m)(?![a-z])/i;

/** 現実的な上限（24時間）。数字を取り違えた貼り付けを入れない。 */
const MAX_MINUTES = 24 * 60;

export function parseGoogleMapsDuration(text: string): number | null {
  const normalized = text.normalize("NFKC");
  const hit = /\d+\s*(?:時間|hours?|hrs?|h(?![a-z])|分|minutes?|mins?|m(?![a-z]))/i.exec(normalized);
  if (!hit) return null;

  // 先頭の所要時間表記から「時間＋分」の組を読む（後ろに別の経路の値が続いても拾わない）。
  const segment = normalized.slice(hit.index, hit.index + 24);
  const hours = HOURS.exec(segment);
  const rest = hours ? segment.slice(hours.index + hours[0].length) : segment;
  const minutes = MINUTES.exec(rest.slice(0, 12));
  // 「1時間」の直後でなく離れた先にある分（別の値）は拾わない。
  const adjacentMinutes = minutes && (!hours || /^\s*$/.test(rest.slice(0, minutes.index))) ? minutes : null;

  const total = (hours ? Number(hours[1]) * 60 : 0) + (adjacentMinutes ? Number(adjacentMinutes[1]) : 0);
  return total >= 1 && total <= MAX_MINUTES ? total : null;
}
