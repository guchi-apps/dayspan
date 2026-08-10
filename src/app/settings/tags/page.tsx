import { redirect } from "next/navigation";

import { SettingsShell } from "@/components/settings/settings-shell";
import { TagSection, type TagSectionState } from "@/components/settings/tag-section";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { loadTagCatalog } from "@/services/notion/tag-options";

/** NotionのページURL。IDのハイフンを外した形がそのままURLになる。 */
function notionUrl(databaseId: string | null): string | null {
  return databaseId ? `https://www.notion.so/${databaseId.replaceAll("-", "")}` : null;
}

export default async function TagSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const connection = await db.notionConnection.findUnique({ where: { userId: user.id } });
  if (!connection) redirect("/settings/notion");

  const catalog = await loadTagCatalog(connection);

  const sections: TagSectionState[] = [
    {
      kind: "task",
      title: "タスクのタグ",
      description: "タスクに付けられるタグです。入力画面では、ここに並んだものから選べます。",
      options: catalog.task,
      missingMessage:
        "タスクDBにタグ（マルチセレクト）のプロパティがありません。Notion側で追加してから、設定のNotion画面でタスクDBを選び直してください。",
      databaseUrl: notionUrl(connection.taskDatabaseId),
    },
    {
      kind: "reminder",
      title: "日付リマインドの種類",
      description: "日付リマインドに付けられる種類です。1件につき1つだけ選べます。",
      options: catalog.reminder,
      missingMessage:
        "日付リマインドDBに種類（セレクト）のプロパティがありません。Notion側で追加してから、設定のNotion画面で日付リマインドDBを選び直してください。",
      databaseUrl: notionUrl(connection.reminderDatabaseId),
    },
  ];

  return (
    <SettingsShell
      title="タグ"
      description="タスクのタグと日付リマインドの種類を、色つきで登録しておけます。"
      backHref="/settings"
      backLabel="設定"
    >
      {sections.map((section) => (
        <TagSection key={section.kind} state={section} />
      ))}
    </SettingsShell>
  );
}
