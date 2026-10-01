import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionConnection } from "@/services/calendar/write-context";
import { importTasksFromNotion, startTasksInDb } from "@/services/tasks";

type Body = { mode?: "import" | "fresh" };

/**
 * タスクの本体をYoteiFlowのDBへ移す（issue #919）。設定画面でユーザーが押したときだけ実行する。
 * `import` はNotionから取り込む（Notionが応答しなければ失敗し、切り替わらない）。
 * `fresh` は取り込まず空のDBで始める（Notionが落ちている間でも使える）。
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
      await startTasksInDb(userId);
      return NextResponse.json({ ok: true, imported: 0 });
    }
    const { imported } = await importTasksFromNotion(connection);
    return NextResponse.json({ ok: true, imported });
  } catch (error) {
    return externalApiError("notion", "タスクの取り込み", error);
  }
}
