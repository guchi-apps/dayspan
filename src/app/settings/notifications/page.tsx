import { redirect } from "next/navigation";

import { NotificationSection } from "@/components/settings/notification-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { getVapidKeys, isPushConfigured } from "@/lib/web-push/keys";
import { getNotificationSettings } from "@/services/notifications/settings";
import { countSubscriptions } from "@/services/notifications/subscriptions";

/**
 * 通知の設定（docs/spec.md §32）。
 *
 * 公開鍵はここでサーバー側から渡す。NEXT_PUBLIC_ の環境変数にするとビルド時に埋め込まれ、
 * 鍵を入れ替えるたびにビルドし直すことになる（値を配るのはCIで、本番の .env はデプロイ時に書く）。
 */
export default async function NotificationSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [settings, deviceCount, uiSetting] = await Promise.all([
    getNotificationSettings(user.id),
    countSubscriptions(user.id),
    db.uiSetting.findUnique({ where: { userId: user.id }, select: { timeZone: true } }),
  ]);

  return (
    <SettingsShell
      title="通知"
      description="予定の前とタスクの期限に知らせます。iPhoneではホーム画面に追加したDaySpanでのみ受け取れます。"
      backHref="/settings"
      backLabel="設定"
    >
      <NotificationSection
        settings={settings}
        publicKey={publicKey()}
        deviceCount={deviceCount}
        timeZone={uiSetting?.timeZone ?? "Asia/Tokyo"}
      />
    </SettingsShell>
  );
}

/**
 * 送信に使う鍵の公開側。鍵の組が食い違っていると getVapidKeys() が断るため、
 * 画面には「未設定」と同じ扱いで出す（購読だけ作れて配信が落ち続ける状態を作らない）。
 */
function publicKey(): string | null {
  if (!isPushConfigured()) return null;

  try {
    return getVapidKeys().publicKey;
  } catch (error) {
    console.error("[dayspan] VAPID keys are unusable:", error);
    return null;
  }
}
