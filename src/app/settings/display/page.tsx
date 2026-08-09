import { redirect } from "next/navigation";

import { DisplaySection } from "@/components/settings/display-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";

export default async function DisplaySettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const uiSetting = await db.uiSetting.findUnique({ where: { userId: user.id } });

  // カレンダー側と既定値を揃える。UiSettingが未作成のユーザーは日曜始まり。
  return (
    <SettingsShell
      title="表示"
      description="カレンダーの見た目に関する設定です。"
      backHref="/settings"
      backLabel="設定"
    >
      <DisplaySection weekStartsOn={uiSetting?.weekStartsOn ?? 0} />
    </SettingsShell>
  );
}
