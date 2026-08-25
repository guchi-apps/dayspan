import { NextResponse } from "next/server";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { getNotionWorkConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { listPendingWorkRecords } from "@/services/notion/work-logs";
import { workTodos } from "@/types/work";

/**
 * 手続きが残っている出張・年休の件数（docs/spec.md §34）。
 *
 * メニュー（ドロワー）を開いたときにだけ読む。各画面のサーバー側で数えると、勤務記録を
 * 開かない日もNotionへの往復が画面の数だけ増える（記録の長押しシートと同じ扱い）。
 *
 * 未設定・失敗は0件として返す。ここで500を返しても、メニューの1行に出す数字が無いだけで
 * メニューそのものは開ける必要があるため。
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await getNotionWorkConnection(userId);
  if (!connection) return NextResponse.json({ count: 0 });

  const setting = await db.uiSetting.findUnique({
    where: { userId },
    select: { timeZone: true },
  });
  const todayKey = createCalendarDateUtils(setting?.timeZone ?? "Asia/Tokyo").todayKey();

  try {
    const pending = await listPendingWorkRecords(createNotionClient(connection), connection);
    const count = pending.reduce((total, record) => total + workTodos(record, todayKey).length, 0);
    return NextResponse.json({ count });
  } catch (error) {
    console.error("[dayspan] notion 未対応の勤務記録の取得 failed:", error);
    return NextResponse.json({ count: 0 });
  }
}
