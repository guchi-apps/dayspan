/**
 * 記録を始めてからの長さ。
 *
 * 秒は出さない。記録の刻みは分（Google Calendarの予定として保存する単位）で、
 * 秒まで動かすと、目に入るたびに数字が変わって画面がざわつくため。
 */
export function formatElapsed(startIso: string, nowIso: string): string {
  const minutes = Math.max(
    0,
    Math.floor((new Date(nowIso).getTime() - new Date(startIso).getTime()) / 60_000),
  );

  if (minutes < 60) return `${minutes}分`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
}
