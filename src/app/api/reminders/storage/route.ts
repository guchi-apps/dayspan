import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionConnection } from "@/services/calendar/write-context";
import { importRemindersFromNotion, startRemindersInDb } from "@/services/reminders";

type Body = { mode?: "import" | "fresh" };

/**
 * 日付リマインドの本体をYoteiFlowのDBへ移す（issue #928）。設定画面でユーザーが押したときだけ実行する。
 * `import` はNotionから取り込む（Notionが応答しなければ失敗し、切り替わらない）。
 * `fresh` は取り込まず空のDBで始める。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await getNotionConnection(userId);
  if (!connection) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const body = (await request.json()) as Body;
  if (body.mode !== "import" && body.mode !== "fresh") {
    return NextResponse.json({ error: "mode is required" }, { status: 400 });
  }

  try {
    if (body.mode === "fresh") {
      await startRemindersInDb(userId);
      return NextResponse.json({ ok: true, imported: 0 });
    }
    const { imported } = await importRemindersFromNotion(connection);
    return NextResponse.json({ ok: true, imported });
  } catch (error) {
    return externalApiError("notion", "日付リマインドの取り込み", error);
  }
}
