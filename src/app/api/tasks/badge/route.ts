import { NextResponse, type NextRequest } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { loadBadgeCounts } from "@/services/notifications/badge";

/**
 * アプリアイコンのバッジに出す件数（docs/spec.md §32）。
 *
 * 件数は tasks（期限が今日以前の未完了タスク）と shopping（購入予定日が今日以前の未購入）、
 * count はその合計。タスクの数え方はタスク画面の分類と同じ関数を通すため、
 * 見出しの「期限切れ」「今日」の合計と必ず一致する。
 *
 * 呼ぶのは画面側（AppBadgeSync）で、10分に1回までに絞っている。Notionへの往復が
 * 画面を開くたびに増えないようにするため（docs/spec.md §20）。
 *
 * `?only=tasks` / `?only=shopping` を付けると、その側だけをNotionへ取りにいく（もう片方は null）。
 * タスク・買い物の画面は自分の側を取得済みの一覧から数えているため、残りの側だけを求める。
 * 片側だけのときは合計（count）も null になる。
 */
export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const only = request.nextUrl.searchParams.get("only");
  if (only !== null && only !== "tasks" && only !== "shopping") {
    return NextResponse.json({ error: "invalid_only" }, { status: 400 });
  }
  const counts = await loadBadgeCounts(userId, {
    tasks: only !== "shopping",
    shopping: only !== "tasks",
  });

  // 取れなかったときは null。0（1件も無い）と区別できる必要がある。
  // count は合計（アイコンのバッジ）で、従来の形のまま残す。
  return NextResponse.json(
    { count: counts.total, tasks: counts.tasks, shopping: counts.shopping },
    { headers: { "Cache-Control": "no-store" } },
  );
}
