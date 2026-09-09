import { redirect } from "next/navigation";

import { isoToLocalInput } from "@/components/calendar/datetime-fields";
import { SettingsShell } from "@/components/settings/settings-shell";
import { ShortcutsSection } from "@/components/settings/shortcuts-section";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { getOriginFromHeaders } from "@/lib/request-origin";
import { getSleepSettings } from "@/services/activity/settings";
import { getShortcutToken } from "@/services/activity/shortcut-token";

/**
 * iPhoneショートカットの設定（docs/spec.md §40）。
 *
 * ショートカットはScriptableの台本と違って文字列として配れない。オートメーションは利用者が
 * 端末の画面で1つずつ組み立てるものなので、**手順を案内して値をコピーさせる**。
 *
 * Google未接続でも開ける（トークンの発行そのものは連携に依らない）。実際に記録できるかは
 * 保存先カレンダーが決まっているかで変わり、決まっていなければ呼んだときに理由が返る。
 */
export default async function ShortcutsSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [info, origin, uiSetting, sleep] = await Promise.all([
    getShortcutToken(user.id),
    getOriginFromHeaders(),
    db.uiSetting.findUnique({ where: { userId: user.id }, select: { timeZone: true } }),
    getSleepSettings(user.id),
  ]);

  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";

  return (
    <SettingsShell
      title="iPhoneショートカット"
      description="iPhoneの個人用オートメーション（就寝時・アラームの停止時）とヘルスケアの睡眠分析から、睡眠を活動記録として残します。"
      backHref="/settings"
      backLabel="設定"
    >
      <ShortcutsSection
        initialToken={info?.token ?? null}
        lastUsedLabel={
          info?.lastUsedAt ? isoToLocalInput(info.lastUsedAt, timeZone).replace("T", " ") : null
        }
        // 送り先は開いているアドレスから作る。利用者に値を組み立てさせると、打ち間違いに
        // 気付ける場所が実機のオートメーション（何も起きない）しかなくなる。
        endpointBase={`${origin}/api/shortcuts`}
        sleepTitle={sleep.title}
      />
    </SettingsShell>
  );
}
