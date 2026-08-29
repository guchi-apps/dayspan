import { redirect } from "next/navigation";

import { SettingsShell } from "@/components/settings/settings-shell";
import { TagSection, type TagSectionState } from "@/components/settings/tag-section";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { loadTagCatalog, loadTagOptions } from "@/services/notion/tag-options";
import { workCapabilities, workTripPlaces } from "@/services/notion/work-logs";

/** NotionのページURL。IDのハイフンを外した形がそのままURLになる。 */
function notionUrl(databaseId: string | null): string | null {
  return databaseId ? `https://www.notion.so/${databaseId.replaceAll("-", "")}` : null;
}

export default async function TagSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const connection = await db.notionConnection.findUnique({ where: { userId: user.id } });
  if (!connection) redirect("/settings/notion");

  // 場所のタグは loadTagCatalog に含めない。あれはカレンダー・タスク・日付リマインドの
  // 各ページも呼んでおり、そこで使わない選択肢のためにNotionへの往復を増やさないため
  // （docs/spec.md §20）。この画面だけが1種類ぶんを別に読む。
  const [catalog, placeOptions] = await Promise.all([
    loadTagCatalog(connection),
    loadTagOptions(connection, "place"),
  ]);

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
    {
      kind: "work",
      title: "勤務場所",
      description: "勤務の記録に付けられる場所です。1件につき1つだけ選べます。",
      options: catalog.work,
      missingMessage:
        "勤務記録DBに勤務場所（セレクト）のプロパティがありません。Notion側で追加してから、設定のNotion画面で勤務記録DBを選び直してください。",
      databaseUrl: notionUrl(connection.workDatabaseId),
      // 行けば必ず出張になる勤務先は、場所を選んだ時点で出張の既定を立てる（docs/spec.md §34）。
      // 選択肢の一覧がここにあるため、場所ごとの設定も同じ行に添える。
      trip: {
        places: workTripPlaces(connection),
        available: workCapabilities(connection).businessTrip,
      },
    },
    {
      kind: "shopping",
      title: "買い物のカテゴリ",
      description:
        "買い物リストの項目に付けられるカテゴリです。買い物画面のタブもこの並び順で出ます。",
      options: catalog.shopping,
      missingMessage:
        "買い物リストDBにカテゴリ（セレクト）のプロパティがありません。Notion側で追加してから、設定のNotion画面で買い物リストDBを選び直してください。",
      databaseUrl: notionUrl(connection.shoppingDatabaseId),
    },
    {
      kind: "place",
      title: "場所のタグ",
      description:
        "登録した場所に付けられるタグです。場所の編集画面では、ここに並んだものから選べます。",
      options: placeOptions,
      missingMessage:
        "場所DBにタグ（マルチセレクト）のプロパティがありません。Notion側で追加してから、設定のNotion画面で場所DBを選び直してください。",
      databaseUrl: notionUrl(connection.placeDatabaseId),
    },
  ];

  return (
    <SettingsShell
      title="タグ"
      description="タスクのタグ・日付リマインドの種類・勤務場所・買い物のカテゴリ・場所のタグを、色つきで登録しておけます。"
      backHref="/settings"
      backLabel="設定"
    >
      {sections.map((section) => (
        <TagSection key={section.kind} state={section} />
      ))}
    </SettingsShell>
  );
}
