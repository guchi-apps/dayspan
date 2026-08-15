import { redirect } from "next/navigation";

import { GoogleCalendarSection } from "@/components/settings/google-calendar-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { getCurrentUser } from "@/lib/auth-user";
import { loadCalendarSettings } from "@/services/google-calendar/settings";

export default async function GoogleSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ google }, result] = await Promise.all([searchParams, loadCalendarSettings(user.id)]);

  return (
    <SettingsShell
      title="Google Calendar"
      description="カレンダーごとに、表示するか・書き込みに使うかと並び順を選びます。ログインとは別に、カレンダーの読み書き権限を接続します。"
      backHref="/settings"
      backLabel="設定"
    >
      <GoogleCalendarSection result={result} connectResult={google} />
    </SettingsShell>
  );
}
