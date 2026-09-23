import { redirect } from "next/navigation";

import { SettingsShell } from "@/components/settings/settings-shell";
import { TagSection, type TagSectionState } from "@/components/settings/tag-section";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { loadTagOptions } from "@/services/notion/tag-options";

/** NotionのページURL。IDのハイフンを外した形がそのままURLになる。 */
function notionUrl(databaseId: string | null): string | null {
  return databaseId ? `https://www.notion.so/${databaseId.replaceAll("-", "")}` : null;
}

export default async function TaskSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const connection = await db.notionConnection.findUnique({ where: { userId: user.id } });
  if (!connection) redirect("/settings/notion");

  const options = await loadTagOptions(connection, "task");

  const state: TagSectionState = {
    kind: "task",
    title: "タスクのタグ",
    description: "タスクに付けられるタグです。入力画面では、ここに並んだものから選べます。",
    options,
    missingMessage:
      "タスクDBにタグ（マルチセレクト）のプロパティがありません。Notion側で追加してから、設定のNotion画面でタスクDBを選び直してください。",
    databaseUrl: notionUrl(connection.taskDatabaseId),
  };

  return (
    <SettingsShell
      title="タスク"
      description="タスクのタグを色つきで登録しておけます。"
      backHref="/settings"
      backLabel="設定"
    >
      <TagSection state={state} />
    </SettingsShell>
  );
}
