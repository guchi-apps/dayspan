import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { GoogleCalendarSection } from "@/components/settings/google-calendar-section";
import { NotionSection, type NotionSectionState } from "@/components/settings/notion-section";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { loadCalendarSettings } from "@/services/google-calendar/settings";
import { createNotionClient } from "@/services/notion/client";
import {
  listCandidateDataSources,
  type DataSourceSummary,
  type PropertyMap,
} from "@/services/notion/task-database";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { google } = await searchParams;

  const [calendarResult, notionState] = await Promise.all([
    loadCalendarSettings(user.id),
    loadNotionState(user.id),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/calendar">
            <ArrowLeft className="size-4" />
            カレンダー
          </Link>
        </Button>
      </div>

      <h1 className="text-xl font-semibold">設定</h1>

      <GoogleCalendarSection result={calendarResult} connectResult={google} />
      <NotionSection state={notionState} />
    </div>
  );
}

async function loadNotionState(userId: string): Promise<NotionSectionState> {
  const connection = await db.notionConnection.findUnique({ where: { userId } });

  if (!connection) {
    return {
      connected: false,
      workspaceName: null,
      taskDataSourceId: null,
      taskTitle: null,
      propertyMap: null,
      dataSources: [],
      dataSourcesFailed: false,
    };
  }

  // 候補一覧の取得に失敗しても設定画面自体は開けるようにする。
  // トークン失効時にここで例外を投げると、接続の解除もできなくなるため。
  let dataSources: DataSourceSummary[] = [];
  let dataSourcesFailed = false;
  try {
    dataSources = await listCandidateDataSources(createNotionClient(connection));
  } catch {
    dataSourcesFailed = true;
  }

  return {
    connected: true,
    workspaceName: connection.workspaceName,
    taskDataSourceId: connection.taskDataSourceId,
    taskTitle: connection.taskTitle,
    propertyMap: (connection.propertyMap as PropertyMap | null) ?? null,
    dataSources,
    dataSourcesFailed,
  };
}
