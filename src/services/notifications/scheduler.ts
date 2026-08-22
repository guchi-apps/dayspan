import { isPushConfigured } from "@/lib/web-push/keys";
import { dispatchDueNotifications } from "@/services/notifications/dispatch";
import { listUsersToPlan, planUserNotifications } from "@/services/notifications/plan";

/**
 * 通知を送るためのタイマー（docs/spec.md §32）。
 *
 * iOSのホーム画面Webアプリには端末側で通知を予約する手段が無いため、時刻が来たことに
 * 気付けるのはサーバーだけになる。PM2はDaySpanを1プロセス（fork・instances: 1）で動かすので、
 * この中で数えていれば二重に送られることはない。
 *
 * 同じ処理は POST /api/internal/notifications/dispatch からも呼べる。手で確かめるときと、
 * 将来VPSのcronへ移すときの入口になる。
 */

/** 送信の間隔。時刻の指定が分単位なので、これ以上細かくしても意味が無い。 */
const TICK_MS = 60_000;

let started = false;

export function startNotificationScheduler(): void {
  if (started) return;
  started = true;

  // 鍵が無い環境（開発中の worktree など）では、送る相手も購読も作れない。
  // 毎分DBを引くだけの空回りになるため、そもそも始めない。
  if (!isPushConfigured()) {
    console.info("[dayspan] notification scheduler: VAPIDの鍵が未設定のため起動しません。");
    return;
  }

  const timer = setInterval(() => {
    void runTick();
  }, TICK_MS);

  // このタイマーだけを理由にプロセスを生かし続けない。
  timer.unref();

  console.info("[dayspan] notification scheduler started.");
}

/** 1回ぶんの処理。送信を先に行い、そのあとで下書きを作り直す。 */
export async function runTick(now: Date = new Date()): Promise<void> {
  try {
    await dispatchDueNotifications(now);
  } catch (error) {
    console.error("[dayspan] notification dispatch failed:", error);
  }

  try {
    const userIds = await listUsersToPlan(now);
    for (const userId of userIds) {
      await planUserNotifications(userId, now);
    }
  } catch (error) {
    console.error("[dayspan] notification plan failed:", error);
  }
}
