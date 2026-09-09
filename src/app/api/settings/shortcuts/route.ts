import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { deleteShortcutToken, issueShortcutToken } from "@/services/activity/shortcut-token";

/**
 * ショートカット用トークンの発行・作り直し（docs/spec.md §40）。
 *
 * 発行と作り直しを分けない。画面から見ればどちらも「新しいトークンを作る」操作で、
 * 分けると押す前に現在の有無を利用者が意識することになる（ウィジェット用と同じ扱い）。
 *
 * ウィジェットと違って配る台本が無いため、返すのはトークンだけ。オートメーションへ入れる
 * 値（`Authorization` ヘッダーと送り先URL）は設定画面が組み立ててコピーさせる。
 */
export async function POST() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = await issueShortcutToken(userId);

  return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
}

/** トークンを削除する。以後どの端末のオートメーションからも記録できなくなる。 */
export async function DELETE() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const deleted = await deleteShortcutToken(userId);
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
