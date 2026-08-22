"use client";

import { ACTIVITY_NOTIFICATION_TAG } from "@/lib/notification-tags";

/**
 * 「記録中」の通知を消す（docs/spec.md §32）。
 *
 * 記録を止めた・取り消した時点で、その通知は事実と違うものになる。消せるのは操作した端末の
 * ぶんだけで、別の端末に出ている通知はそのまま残る（消すためだけにもう1通送ると、iOSでは
 * 「記録が終わりました」という通知が増えるだけになる）。
 */
export async function closeActivityNotification(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const notifications = await registration?.getNotifications({
      tag: ACTIVITY_NOTIFICATION_TAG,
    });

    for (const notification of notifications ?? []) notification.close();
  } catch {
    // 消せなくても記録そのものには影響しない。通知は押せば記録の画面へ移る。
  }
}
