import { db } from "@/lib/db";
import { sendToUser } from "@/services/notifications/subscriptions";

/**
 * 時刻が来た下書きを送る（docs/spec.md §32）。
 *
 * ここでは外部APIを見ない。送る内容は下書きを作った時点で決まっている（plan.ts）。
 */

/** 送るのをやめる遅れ。デプロイやサーバーの再起動をまたいだ通知は、届いても意味が変わっている。 */
const MAX_DELAY_MINUTES = 60;

/** 送信済みの記録を残す期間。同じ鍵の下書きを作り直しても二度目を送らないための印。 */
const KEEP_SENT_DAYS = 7;

/** 1回で送る上限。時計が大きく戻ったときなどに、まとめて何十件も出さないための保険。 */
const MAX_PER_RUN = 20;

export type DispatchResult = {
  sent: number;
  /** 遅れが大きく、送らずに終わらせた下書きの数。 */
  skipped: number;
};

export async function dispatchDueNotifications(now: Date = new Date()): Promise<DispatchResult> {
  const jobs = await db.notificationJob.findMany({
    where: { sentAt: null, scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: MAX_PER_RUN,
  });

  const result: DispatchResult = { sent: 0, skipped: 0 };
  const staleBefore = new Date(now.getTime() - MAX_DELAY_MINUTES * 60_000);

  for (const job of jobs) {
    // 送ったかどうかの印は、送る前に立てる。送信が長引いて次のタイマーが重なっても、
    // 同じ通知を2回送らないため。送信に失敗しても送り直さない（時刻を過ぎた通知のため）。
    await db.notificationJob.update({ where: { id: job.id }, data: { sentAt: now } });

    if (job.scheduledAt < staleBefore) {
      result.skipped += 1;
      continue;
    }

    await sendToUser(
      job.userId,
      {
        title: job.title,
        body: job.body,
        path: job.url,
        badge: job.badgeCount,
      },
      // 同じ下書きの再送は無い。まだ届いていない古い通知を置き換える必要も無いため、
      // Topic は付けない（記録の通知だけが Topic を使う）。
      { ttlSeconds: MAX_DELAY_MINUTES * 60 },
    );

    result.sent += 1;
  }

  await purgeOldJobs(now);

  return result;
}

async function purgeOldJobs(now: Date): Promise<void> {
  await db.notificationJob.deleteMany({
    where: { sentAt: { lt: new Date(now.getTime() - KEEP_SENT_DAYS * 86_400_000) } },
  });
}
