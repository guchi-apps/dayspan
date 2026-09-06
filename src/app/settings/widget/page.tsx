import { redirect } from "next/navigation";

import { isoToLocalInput } from "@/components/calendar/datetime-fields";
import { SettingsShell } from "@/components/settings/settings-shell";
import { WidgetSection } from "@/components/settings/widget-section";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { getOriginFromHeaders } from "@/lib/request-origin";
import {
  WIDGET_REFRESH_MINUTES,
  WIDGET_VIEW_CHOICES,
  buildScriptableWidgetScript,
  buildWidgetOpenUrls,
} from "@/lib/scriptable-widget";
import { getWidgetToken } from "@/services/activity/widget-token";

/**
 * iPhoneウィジェットの設定（docs/spec.md §28）。
 *
 * Google未接続でも開ける。記録中の1件はDaySpanのDBにあり、Googleがなくても出せるため
 * （今日の合計だけが出せない）。予定・タスク・買い物リストの面も、連携が未設定なら
 * ウィジェット側に何を設定すればよいかが出る。
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
      description="Scriptableを使って、iPhoneのホーム画面・ロック画面に活動記録・今日の予定・タスク・買い物リストを表示します。"
      backHref="/settings"
      backLabel="設定"
    >
      <WidgetSection
        initialToken={info?.token ?? null}
        initialScript={
          info
            ? buildScriptableWidgetScript({
                endpointBase: `${origin}/api/widget`,
                token: info.token,
                appUrl: origin,
              })
            : null
        }
        lastUsedLabel={
          info?.lastUsedAt ? isoToLocalInput(info.lastUsedAt, timeZone).replace("T", " ") : null
        }
        // 開く先はトークンの有無に関係なくoriginだけで決まる。台本と違って発行APIの応答には
        // 含めず、ここで作って渡す。
        openUrls={buildWidgetOpenUrls(origin)}
        refreshMinutes={WIDGET_REFRESH_MINUTES}
        // 面の一覧はサーバー側から渡す。クライアントから直接importすると、台本の本文
        // （14KB弱）が設定画面のJavaScriptに付いてくる（台本を組み立てているのと同じ理由）。
        viewChoices={WIDGET_VIEW_CHOICES}
      />
    </SettingsShell>
  );
}
