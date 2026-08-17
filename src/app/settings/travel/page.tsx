import { redirect } from "next/navigation";

import { SettingsShell } from "@/components/settings/settings-shell";
import { TravelSection } from "@/components/settings/travel-section";
import { getCurrentUser } from "@/lib/auth-user";
import { loadWritableCalendars } from "@/services/calendar/load";
import { getTravelSettings } from "@/services/travel/settings";

export default async function TravelSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // 移動そのものはDaySpanのDBにあるため、Google未接続でも設定は開ける
  // （書き出し先が選べないだけで、出発地・交通手段・往復は使える）。
  const [settings, calendars] = await Promise.all([
    getTravelSettings(user.id),
    loadWritableCalendars(user.id),
  ]);

  return (
    <SettingsShell
      title="移動"
      description="出発地から目的地までの移動です。予定の詳細から「移動を足す」で作れます。Googleカレンダーへも書き出すと、他の端末のカレンダーからも見られます。"
      backHref="/settings"
      backLabel="設定"
    >
      <TravelSection settings={settings} calendars={calendars} />
    </SettingsShell>
  );
}
