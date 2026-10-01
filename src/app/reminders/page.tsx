import Link from "next/link";
import { redirect } from "next/navigation";
import { BellRing } from "lucide-react";

import { AppBadgeSync } from "@/components/notifications/app-badge-sync";
import { ReminderList } from "@/components/reminders/reminder-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { listAllReminders, reminderSourceReady } from "@/services/reminders";
import { loadTagCatalog } from "@/services/notion/tag-options";
import { loadPlaceCatalog } from "@/services/notion/places";
import { loadWritableCalendars } from "@/services/calendar/load";
import type { ReminderItem } from "@/types/calendar";

export default async function RemindersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [uiSetting, connection] = await Promise.all([
    db.uiSetting.findUnique({ where: { userId: user.id } }),
    db.notionConnection.findUnique({ where: { userId: user.id } }),
  ]);
  if (!connection || !reminderSourceReady(connection)) return <ConnectPrompt />;

  let reminders: ReminderItem[] = [];
  let loadError: string | null = null;
  // 種類の取得は失敗しても空になるだけで、日付リマインドの表示は妨げない。
  const tagCatalogPromise = loadTagCatalog(connection);
  const placeCatalogPromise = loadPlaceCatalog(connection);
  const calendarsPromise = loadWritableCalendars(user.id);
  try {
    reminders = await listAllReminders(connection);
  } catch {
    loadError = "日付リマインドを取得できませんでした。";
  }
  return (
    <>
      <AppBadgeSync />
      <ReminderList
        reminders={reminders}
        tagCatalog={await tagCatalogPromise}
        placeCatalog={await placeCatalogPromise}
        calendars={await calendarsPromise}
        weekStartsOn={uiSetting?.weekStartsOn ?? 0}
        timeZone={uiSetting?.timeZone ?? "Asia/Tokyo"}
        loadError={loadError}
      />
    </>
  );
}

function ConnectPrompt() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2 text-xl font-semibold"><BellRing className="size-6 text-primary" />日付リマインド</div>
      <Card>
        <CardHeader>
          <CardTitle>日付リマインドDBが設定されていません</CardTitle>
          <CardDescription>設定画面でNotionの日付リマインドDBを選択してください。</CardDescription>
        </CardHeader>
        <CardContent><Button asChild><Link href="/settings/notion">Notion設定へ</Link></Button></CardContent>
      </Card>
    </div>
  );
}
