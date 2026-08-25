import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import {
  ActivityCalendarNotFoundError,
  ActivityTimeRangeError,
  stopRunningActivity,
} from "@/services/activity/running";

type Body = {
  /** 終了時刻（ISO 8601）。止め忘れに気付いたとき以外は送らない。 */
  endedAt?: string;
};

/**
 * 記録を終わらせ、Google Calendarの予定にする（docs/spec.md §27）。
 *
 * 終了時刻は既定ではサーバーの時計で決める。開始時刻と同じ時計で測らないと、
 * 端末の時計のずれがそのまま記録の長さのずれになる。止め忘れて後から止めるときだけ
 * endedAt を受け、それでも未来は受けない（サービス側の resolveRecordTime）。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 下部ナビのクイックシートと記録画面の「停止して保存」は本文を付けずにPOSTする。
  // JSONとして読めないことは失敗ではなく「時刻の指定が無い」ことを意味する。
  const body = ((await request.json().catch(() => ({}))) ?? {}) as Body;

  const endedAt = body.endedAt ? new Date(body.endedAt) : new Date();
  if (Number.isNaN(endedAt.getTime())) {
    return NextResponse.json({ error: "endedAt is invalid" }, { status: 400 });
  }

  try {
    const result = await stopRunningActivity(userId, endedAt);

    if (result.status === "not_running") {
      return NextResponse.json({ error: "not_running" }, { status: 404 });
    }

    return NextResponse.json({ saved: result.range });
  } catch (error) {
    if (error instanceof ActivityTimeRangeError) {
      return NextResponse.json({ error: "invalid_time", message: error.message }, { status: 400 });
    }
    if (error instanceof ActivityCalendarNotFoundError) {
      return NextResponse.json(
        { error: "calendar_not_found", message: error.message },
        { status: 404 },
      );
    }
    return externalApiError("google", "活動記録の保存", error);
  }
}
