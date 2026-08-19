import type { GoogleEvent } from "@/services/google-calendar/events";

/**
 * ウィジェットが読む「今日の記録」の元になる予定を、プロセス内で短時間だけ持ち回す
 * （docs/spec.md §28）。
 *
 * ウィジェットは更新のたびにGoogle Calendarへ1回問い合わせる。ロック画面ぶんを足すと、
 * 同じ人の同じ1日を見るために置いた枠の数だけ往復が増える。iOSは同じアプリのウィジェットを
 * まとめて更新するため、そのぶんが1回で済むようにする（docs/spec.md §20
 * 「過剰なアクセスを発生させない」）。
 *
 * 持つのは取得した予定の配列だけで、合計は毎回 summarizeActivityMinutes() で計算し直す。
 * 記録中のぶんは現在時刻で伸び続けるため、計算した後の数字を持つと合計だけが止まる。
 *
 * 本番はPM2の `instances: 1` / `exec_mode: "fork"`（deploy/ecosystem.config.js）で1プロセス。
 * 増やしたときもプロセスごとに持つだけで、正しさは変わらない（往復が減りにくくなるだけ）。
 */

/**
 * 持ち回す時間。
 *
 * 台本が要求する更新間隔（WIDGET_REFRESH_MINUTES = 5分）より短くしてある。同じ枠の次の更新は
 * 必ず取り直しになり、まとめて走った他の枠のぶんだけが1回に収まる。長くすると、Google側で
 * 直接足した記録が今日の合計へ載るまでの遅れがそのぶん伸びる。
 */
const TTL_MS = 3 * 60_000;

type CacheEntry = { userId: string; events: GoogleEvent[]; fetchedAt: number };

const cache = new Map<string, CacheEntry>();

/**
 * まだ使える取得結果。無ければ null。
 *
 * 日付・保存先が変われば別の鍵になる。日付が変わった後の古い行は expire() が捨てる。
 */
export function readCachedTodayEvents(
  key: { userId: string; calendarId: string; dateKey: string },
  now: Date,
): GoogleEvent[] | null {
  const entry = cache.get(cacheKey(key));
  if (!entry) return null;

  if (now.getTime() - entry.fetchedAt >= TTL_MS) {
    cache.delete(cacheKey(key));
    return null;
  }

  return entry.events;
}

export function writeCachedTodayEvents(
  key: { userId: string; calendarId: string; dateKey: string },
  events: GoogleEvent[],
  now: Date,
): void {
  expire(now);
  cache.set(cacheKey(key), { userId: key.userId, events, fetchedAt: now.getTime() });
}

/**
 * そのユーザーのぶんを捨てる。記録を止めて予定を作った直後に呼ぶ。
 *
 * 止めたぶんが今日の合計へ載るのを持ち回した時間だけ待たせると、画面では止まっているのに
 * ウィジェットの合計が増えないという食い違いが出る。DaySpanから作った予定はここで分かるため、
 * 待たずに捨てる。
 */
export function clearTodayEventsCache(userId: string): void {
  for (const [key, entry] of cache) {
    if (entry.userId === userId) cache.delete(key);
  }
}

function cacheKey(key: { userId: string; calendarId: string; dateKey: string }): string {
  // 改行で繋ぐ。カレンダーIDはメールアドレスの形をしていて記号が混ざるが、改行は入らない。
  return `${key.userId}\n${key.calendarId}\n${key.dateKey}`;
}

/** 使えなくなった行を落とす。日付が変わるとその日の鍵は二度と引かれず、放っておくと残り続ける。 */
function expire(now: Date): void {
  for (const [key, entry] of cache) {
    if (now.getTime() - entry.fetchedAt >= TTL_MS) cache.delete(key);
  }
}
