import type { ComponentType } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
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
import { getNotificationSettings } from "@/services/notifications/settings";
import { weekStartLabel } from "@/lib/week-start";
import { TRAVEL_MODE_LABELS } from "@/types/calendar";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // 一覧では外部APIを叩かない。カレンダー一覧やタスクDB一覧の取得はそれぞれの画面へ入って
  // からで足り、ここで待たせるとGoogle / Notionが遅い日は設定を開くこと自体ができなくなる。
  const [
    googleAccounts,
    notionConnection,
    uiSetting,
    activityPresetCount,
    widgetToken,
    pushDeviceCount,
    notificationSettings,
  ] = await Promise.all([
    db.googleAccount.findMany({ where: { userId: user.id }, select: { email: true } }),
    db.notionConnection.findUnique({ where: { userId: user.id } }),
    db.uiSetting.findUnique({ where: { userId: user.id } }),
    db.activityPreset.count({ where: { userId: user.id } }),
    // 発行の有無だけを見る。復号は開いてからで足りる。
    db.widgetToken.findUnique({ where: { userId: user.id }, select: { id: true } }),
    db.pushSubscription.count({ where: { userId: user.id } }),
    getNotificationSettings(user.id),
  ]);

  return (
    <SettingsShell title="設定" backHref="/activity" backLabel="記録">
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
        {/* 移動の本体はDaySpanのDBにあるため、Google・Notionが未接続でも使える。常に出す。 */}
        <MenuItem
          href="/settings/travel"
          icon={ArrowRight}
          label="移動"
          value={
            uiSetting?.travelDefaultOrigin
              ? `${uiSetting.travelDefaultOrigin}から / ${TRAVEL_MODE_LABELS[uiSetting.travelDefaultMode]}`
              : `既定の交通手段: ${TRAVEL_MODE_LABELS[uiSetting?.travelDefaultMode ?? "TRAIN"]}`
          }
        />
        {/* 記録中の1件はGoogle未接続でも出せるため、Google接続の有無にかかわらず出す。 */}
        <MenuItem
          href="/settings/widget"
          icon={Smartphone}
          label="iPhoneウィジェット"
          value={widgetToken ? "発行済み" : "未設定"}
        />
        {/* 通知はGoogle・Notionが未接続でも開ける。許可そのものは端末ごとに持つため、
            この行には「この端末で受け取っているか」ではなく登録済みの端末の数を出す。 */}
        <MenuItem
          href="/settings/notifications"
          icon={Bell}
          label="通知"
          value={
            pushDeviceCount === 0
              ? "未設定"
              : notificationSummary(notificationSettings, pushDeviceCount)
          }
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

/** 通知の行に出す現在の値。何を知らせているのかが、開かなくても分かるようにする。 */
function notificationSummary(
  settings: { eventEnabled: boolean; taskEnabled: boolean },
  deviceCount: number,
): string {
  const targets = [
    settings.eventEnabled ? "予定" : null,
    settings.taskEnabled ? "タスク" : null,
  ].filter(Boolean);

  const devices = `${deviceCount}台`;
  return targets.length === 0 ? `${devices} / 知らせない` : `${devices} / ${targets.join("・")}`;
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
