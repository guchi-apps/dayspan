import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { ActivityCalendarNotFoundError, stopRunningActivity } from "@/services/activity/running";

/**
 * 記録を終わらせ、Google Calendarの予定にする（docs/spec.md §27）。
 *
 * 終了時刻はサーバーの時計で決める。開始時刻と同じ時計で測らないと、
 * 端末の時計のずれがそのまま記録の長さのずれになる。
 */
export async function POST() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await stopRunningActivity(userId, new Date());

    if (result.status === "not_running") {
      return NextResponse.json({ error: "not_running" }, { status: 404 });
    }

    return NextResponse.json({ saved: result.range });
  } catch (error) {
    if (error instanceof ActivityCalendarNotFoundError) {
      return NextResponse.json(
        { error: "calendar_not_found", message: error.message },
        { status: 404 },
      );
    }
    return externalApiError("google", "活動記録の保存", error);
  }
}
