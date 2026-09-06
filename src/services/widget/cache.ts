import type { WidgetView } from "@/types/widget";

/**
 * ウィジェットの面ごとの取得結果を、プロセス内で短時間だけ持ち回す（docs/spec.md §28）。
 *
 * ウィジェットは更新のたびに外部APIへ問い合わせる。同じ面をホーム画面とロック画面の両方に
 * 置くと、同じものを見るために枠の数だけ往復が増える。iOSは同じアプリのウィジェットを
 * まとめて更新するため、そのぶんが1回で済むようにする（docs/spec.md §20
 * 「過剰なアクセスを発生させない」）。
 *
 * 活動記録は先に `services/activity/today-cache.ts` が同じことをしている。あちらは保存先
 * カレンダーと日付まで鍵に含み、記録を止めた時点で捨てる作りのため、そのまま残す。
 *
 * 持ち回すのは**取得したもの**だけで、そこから作る値（過ぎた予定かどうか・期限の言葉）は
 * 毎回その時点の時刻で組み立て直す。組み立てた後の値を持つと、日付が変わっても
 * 「今日」のままになるなど、時刻に追随すべき部分だけが止まる。
 *
 * 本番はPM2の `instances: 1` / `exec_mode: "fork"`（deploy/ecosystem.config.js）で1プロセス。
 * 増やしたときもプロセスごとに持つだけで、正しさは変わらない（往復が減りにくくなるだけ）。
 */

/**
 * 持ち回す時間。
 *
 * 台本が要求する更新間隔（`WIDGET_REFRESH_MINUTES` = 5分）より短くしてある。同じ枠の次の更新は
 * 必ず取り直しになり、まとめて走った他の枠のぶんだけが1回に収まる。
 *
 * 引き換えに、DaySpanの画面で買い物にチェックを付けた直後にウィジェットを見ると、最大この
 * 時間だけ前の状態が出る。書き込みの経路すべてに破棄の呼び出しを足すことはしない。
 */
const TTL_MS = 3 * 60_000;

type CacheEntry = { userId: string; value: unknown; fetchedAt: number };

const cache = new Map<string, CacheEntry>();

/** まだ使える取得結果。無ければ null。 */
export function readWidgetCache<T>(userId: string, view: WidgetView, now: Date): T | null {
  const key = cacheKey(userId, view);
  const entry = cache.get(key);
  if (!entry) return null;

  if (now.getTime() - entry.fetchedAt >= TTL_MS) {
    cache.delete(key);
    return null;
  }

  return entry.value as T;
}

export function writeWidgetCache<T>(userId: string, view: WidgetView, value: T, now: Date): void {
  expire(now);
  cache.set(cacheKey(userId, view), { userId, value, fetchedAt: now.getTime() });
}

function cacheKey(userId: string, view: WidgetView): string {
  // 改行で繋ぐ。ユーザーIDにも面の名前にも改行は入らない。
  return `${userId}\n${view}`;
}

/** 使えなくなった行を落とす。放っておくと、使わなくなった鍵がプロセスの間ずっと残る。 */
function expire(now: Date): void {
  for (const [key, entry] of cache) {
    if (now.getTime() - entry.fetchedAt >= TTL_MS) cache.delete(key);
  }
}
