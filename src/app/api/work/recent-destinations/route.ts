import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { getNotionWorkConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { listRecentTripDestinations, workCapabilities } from "@/services/notion/work-logs";

/**
 * 直近の出張の行き先候補（docs/spec.md §34）。
 *
 * 入力ダイアログで出張タブを開いたときにだけ読む。`/work` のレンダーに含めると、月送り・
 * 今日のチップの1押し・保存後の再取得のたびに往復が増える（未対応の件数をドロワーを
 * 開いたときにだけ読むのと同じ扱い・issue #525）。
 *
 * 未設定・失敗は空配列として返す。候補が無いだけで、行き先はテキスト欄から手入力できる。
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await getNotionWorkConnection(userId);
  if (!connection || !workCapabilities(connection).businessTrip) {
    return NextResponse.json({ destinations: [] });
  }

  try {
    const destinations = await listRecentTripDestinations(
      createNotionClient(connection),
      connection,
    );
    return NextResponse.json({ destinations });
  } catch (error) {
    console.error("[dayspan] notion 直近の出張の行き先の取得 failed:", error);
    return NextResponse.json({ destinations: [] });
  }
}
