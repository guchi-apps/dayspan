import type { ComponentType } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  CalendarDays,
  ChevronRight,
  History,
  LayoutGrid,
  NotebookPen,
  Smartphone,
  Tags,
  Timer,
  UserRound,
} from "lucide-react";

import { SettingsShell } from "@/components/settings/settings-shell";
import { Card } from "@/components/ui/card";
import { APP_VERSION } from "@/lib/app-version";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { weekStartLabel } from "@/lib/week-start";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // 一覧では外部APIを叩かない。カレンダー一覧やタスクDB一覧の取得はそれぞれの画面へ入って
  // からで足り、ここで待たせるとGoogle / Notionが遅い日は設定を開くこと自体ができなくなる。
  const [googleAccounts, notionConnection, uiSetting, activityPresetCount, widgetToken] =
    await Promise.all([
      db.googleAccount.findMany({ where: { userId: user.id }, select: { email: true } }),
      db.notionConnection.findUnique({ where: { userId: user.id } }),
      db.uiSetting.findUnique({ where: { userId: user.id } }),
      db.activityPreset.count({ where: { userId: user.id } }),
      // 発行の有無だけを見る。復号は開いてからで足りる。
      db.widgetToken.findUnique({ where: { userId: user.id }, select: { id: true } }),
    ]);

  return (
    <SettingsShell title="設定" backHref="/calendar" backLabel="カレンダー">
      <Card className="gap-0 py-0">
        <MenuItem
          href="/settings/google"
          icon={CalendarDays}
          label="Google Calendar"
          value={
            googleAccounts.length === 0
              ? "未接続"
              : googleAccounts.length === 1
                ? googleAccounts[0].email
                : `${googleAccounts.length}件のアカウント`
          }
        />
        <MenuItem
          href="/settings/notion"
          icon={NotebookPen}
          label="Notion"
          value={
            !notionConnection
              ? "未接続"
              : !notionConnection.taskDataSourceId
                ? "タスクDB未選択"
                : (notionConnection.taskTitle ?? "接続済み")
          }
        />
        {/* タグはNotionのプロパティ選択肢が実体のため、接続前は開いても何も出せない。 */}
        {notionConnection && (
          <MenuItem
            href="/settings/tags"
            icon={Tags}
            label="タグ"
            value="タスクのタグと日付リマインドの種類"
          />
        )}
        {/* 記録の保存先はGoogle Calendar。未接続では保存先が選べないため、行ごと出さない。 */}
        {googleAccounts.length > 0 && (
          <MenuItem
            href="/settings/activities"
            icon={Timer}
            label="活動記録"
            value={
              activityPresetCount === 0
                ? "項目なし"
                : `${activityPresetCount}件の項目`
            }
          />
        )}
        {/* 記録中の1件はGoogle未接続でも出せるため、Google接続の有無にかかわらず出す。 */}
        <MenuItem
          href="/settings/widget"
          icon={Smartphone}
          label="iPhoneウィジェット"
          value={widgetToken ? "発行済み" : "未設定"}
        />
        <MenuItem
          href="/settings/display"
          icon={LayoutGrid}
          label="表示"
          value={`週の開始日: ${weekStartLabel(uiSetting?.weekStartsOn ?? 0)}`}
        />
        <MenuItem
          href="/settings/account"
          icon={UserRound}
          label="アカウント"
          value={user.email ?? "ログイン中"}
        />
        <MenuItem
          href="/settings/changelog"
          icon={History}
          label="更新履歴"
          value={`v${APP_VERSION}`}
        />
      </Card>
    </SettingsShell>
  );
}

/**
 * 一覧の1行。現在の値を行に出しておき、開かなくても設定の状態が分かるようにする。
 * 行全体をリンクにするのは、指で押す対象を文字幅ではなく行の高さで確保するため。
 */
function MenuItem({
  href,
  icon: Icon,
  label,
  value,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3.5 transition-colors not-last:border-b not-last:border-outline-variant hover:bg-on-surface/8"
    >
      <Icon className="size-5 shrink-0 text-on-surface-variant" />

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="type-body-large">{label}</span>
        <span className="type-body-small truncate text-on-surface-variant">{value}</span>
      </div>

      <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
    </Link>
  );
}
