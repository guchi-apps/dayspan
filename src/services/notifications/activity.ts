import { isoToLocalInput } from "@/components/calendar/datetime-fields";
import { db } from "@/lib/db";
import { ACTIVITY_NOTIFICATION_TAG } from "@/lib/notification-tags";
import { isPushConfigured } from "@/lib/web-push/keys";
import { getNotificationSettings } from "@/services/notifications/settings";
import { sendToUser } from "@/services/notifications/subscriptions";

/**
 * 記録中であることを通知として残す（docs/spec.md §27・§32）。
 *
 * 止め忘れたまま別のことをしていると、その間ずっと同じ項目を記録し続ける。アプリを開いていない
 * 間もそれが分かる場所は、iPhoneでは通知センターとロック画面しかない。
 *
 * 下書き（NotificationJob）を挟まないのは、送る時刻がいま（押した瞬間）だから。
 */

export async function notifyActivityStarted(
  userId: string,
  running: { title: string; startedAt: Date },
): Promise<void> {
  if (!isPushConfigured()) return;

  const settings = await getNotificationSettings(userId);
  if (!settings.activityEnabled) return;

  const uiSetting = await db.uiSetting.findUnique({
    where: { userId },
    select: { timeZone: true },
  });
  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";
  const startedAt = isoToLocalInput(running.startedAt.toISOString(), timeZone).slice(11);

  await sendToUser(
    userId,
    {
      title: `記録中: ${running.title}`,
      body: `${startedAt}に開始しました。`,
      path: "/activity",
      tag: ACTIVITY_NOTIFICATION_TAG,
      // バッジはタスクの件数を表している。記録の開始で書き換えない。
      badge: null,
    },
    // 切り替えたときは、まだ届いていない前の記録の通知を置き換える。届く順序が入れ替わって
    // 古い項目名が残るのを避ける。
    { topic: ACTIVITY_NOTIFICATION_TAG },
  );
}
