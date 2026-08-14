import { redirect } from "next/navigation";

import { ActivitySection } from "@/components/settings/activity-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { getCurrentUser } from "@/lib/auth-user";
import { listActivityPresets } from "@/services/activity/presets";
import { loadWritableCalendars } from "@/services/calendar/load";

export default async function ActivitySettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // 記録の保存先はGoogle Calendar。接続していないと保存先が選べないため、
  // 先にGoogleの設定へ回ってもらう。
  const [presets, calendars] = await Promise.all([
    listActivityPresets(user.id),
    loadWritableCalendars(user.id),
  ]);

  if (calendars.length === 0) redirect("/settings/google");

  return (
    <SettingsShell
      title="活動記録"
      description="カレンダー画面の記録ボタンに並ぶ項目です。押した時点から記録が始まり、止めた時点までが予定として保存されます。"
      backHref="/settings"
      backLabel="設定"
    >
      <ActivitySection presets={presets} calendars={calendars} />
    </SettingsShell>
  );
}
