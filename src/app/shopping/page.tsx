import Link from "next/link";
import { redirect } from "next/navigation";
import { ShoppingCart } from "lucide-react";

import { ShoppingScreen } from "@/components/shopping/shopping-screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { externalApiMessage } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { listShoppingItems, shoppingDatabaseReady } from "@/services/notion/shopping-items";
import { loadTagOptions } from "@/services/notion/tag-options";
import type { ShoppingItem } from "@/types/shopping";

export default async function ShoppingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [uiSetting, connection, runningActivity] = await Promise.all([
    db.uiSetting.findUnique({ where: { userId: user.id }, select: { timeZone: true } }),
    db.notionConnection.findUnique({ where: { userId: user.id } }),
    // ナビの記録の項目へ印を出すためだけに読む（docs/spec.md §27）。
    db.runningActivity.findUnique({ where: { userId: user.id }, select: { id: true } }),
  ]);

  // データソースと項目名のプロパティが揃っていないと、読むことも書くこともできない。
  if (!connection || !shoppingDatabaseReady(connection)) return <ConnectPrompt />;

  // Notionが失敗しても画面自体は開く。ここで投げるとNext.jsの汎用のエラー画面へ落ち、
  // 何が起きたのかも、再取得できることも画面から分からなくなる（issue #402）。
  let items: ShoppingItem[] = [];
  let loadError: string | null = null;
  try {
    items = await listShoppingItems(createNotionClient(connection), connection);
  } catch (error) {
    loadError = `買い物リストを取得できませんでした。${externalApiMessage("notion", "買い物リストの取得", error)}`;
  }

  // カテゴリの取得は失敗しても空になるだけで、一覧の表示は妨げない（項目に付いている
  // カテゴリ名だけでもタブは組み立てられる）。
  const categoryOptions = await loadTagOptions(connection, "shopping");

  return (
    <ShoppingScreen
      items={items}
      categoryOptions={categoryOptions ?? []}
      timeZone={uiSetting?.timeZone ?? "Asia/Tokyo"}
      loadError={loadError}
      activityRunning={runningActivity !== null}
    />
  );
}

/** 買い物リストDBが未設定のとき。何を用意すればここが使えるようになるのかまで出す。 */
function ConnectPrompt() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2 text-xl font-semibold">
        <ShoppingCart className="size-6 text-primary" />
        買い物リスト
      </div>
      <Card>
        <CardHeader>
          <CardTitle>買い物リストDBが設定されていません</CardTitle>
          <CardDescription>
            買うものはNotionのデータベースに記録します。設定のNotion画面で買い物リストDBを選ぶか、
            新しく作成してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/settings/notion">Notion設定へ</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
