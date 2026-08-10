import Link from "next/link";
import { redirect } from "next/navigation";
import { ListChecks } from "lucide-react";

import { TaskList } from "@/components/tasks/task-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { loadTagCatalog } from "@/services/notion/tag-options";
import { listAllTasks } from "@/services/notion/tasks";
import type { TaskItem } from "@/types/calendar";

export default async function TasksPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [uiSetting, connection] = await Promise.all([
    db.uiSetting.findUnique({ where: { userId: user.id } }),
    db.notionConnection.findUnique({ where: { userId: user.id } }),
  ]);

  if (!connection?.taskDataSourceId) return <ConnectPrompt />;

  // 取得に失敗しても画面は開けるようにする。原因を画面上に出して再取得できる状態を保つ。
  // タグの取得は失敗しても空になるだけで、タスクの表示は妨げない。
  let tasks: TaskItem[] = [];
  let loadError: string | null = null;
  const tagCatalogPromise = loadTagCatalog(connection);
  try {
    tasks = await listAllTasks(createNotionClient(connection), connection);
  } catch {
    loadError = "Notionのタスクを取得できませんでした。";
  }

  return (
    <TaskList
      tasks={tasks}
      tagCatalog={await tagCatalogPromise}
      timeZone={uiSetting?.timeZone ?? "Asia/Tokyo"}
      loadError={loadError}
    />
  );
}

function ConnectPrompt() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2 text-xl font-semibold">
        <ListChecks className="size-6 text-primary" />
        タスク
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Notionが接続されていません</CardTitle>
          <CardDescription>
            設定画面でNotionを接続し、タスクDBを選択するとここに表示されます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/settings">設定へ</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
