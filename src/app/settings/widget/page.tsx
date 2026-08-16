import { redirect } from "next/navigation";

import { isoToLocalInput } from "@/components/calendar/datetime-fields";
import { SettingsShell } from "@/components/settings/settings-shell";
import { WidgetSection } from "@/components/settings/widget-section";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { getOriginFromHeaders } from "@/lib/request-origin";
import { WIDGET_REFRESH_MINUTES, buildScriptableWidgetScript } from "@/lib/scriptable-widget";
import { getWidgetToken } from "@/services/activity/widget-token";

/**
 * iPhoneウィジェットの設定（docs/spec.md §28）。
 *
 * Google未接続でも開ける。記録中の1件はDaySpanのDBにあり、Googleがなくても出せるため
 * （今日の合計だけが出せない）。
 */
export default async function WidgetSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [info, origin, uiSetting] = await Promise.all([
    getWidgetToken(user.id),
    getOriginFromHeaders(),
    db.uiSetting.findUnique({ where: { userId: user.id }, select: { timeZone: true } }),
  ]);

  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";

  return (
    <SettingsShell
      title="iPhoneウィジェット"
      description="Scriptableを使って、iPhoneのホーム画面・ロック画面に活動記録を表示します。"
      backHref="/settings"
      backLabel="設定"
    >
      <WidgetSection
        initialToken={info?.token ?? null}
        initialScript={
          info
            ? buildScriptableWidgetScript({
                endpoint: `${origin}/api/widget/activity`,
                token: info.token,
                appUrl: origin,
              })
            : null
        }
        lastUsedLabel={
          info?.lastUsedAt ? isoToLocalInput(info.lastUsedAt, timeZone).replace("T", " ") : null
        }
        refreshMinutes={WIDGET_REFRESH_MINUTES}
      />
    </SettingsShell>
  );
}
