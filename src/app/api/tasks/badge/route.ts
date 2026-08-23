import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { loadBadgeCount } from "@/services/notifications/badge";

/**
 * アプリアイコンのバッジに出す件数（docs/spec.md §32）。
 *
 * 期限が今日以前の未完了タスクの数。数え方はタスク画面の分類と同じ関数を通すため、
 * 見出しの「期限切れ」「今日」の合計と必ず一致する。
 *
 * 呼ぶのは画面側（AppBadgeSync）で、10分に1回までに絞っている。Notionへの往復が
 * 画面を開くたびに増えないようにするため（docs/spec.md §20）。
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const count = await loadBadgeCount(userId);

  // 取れなかったときは null。0（タスクが1件も無い）と区別できる必要がある。
  return NextResponse.json({ count }, { headers: { "Cache-Control": "no-store" } });
}
