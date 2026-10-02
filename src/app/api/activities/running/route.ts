import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { activityConflictResponse, parseExpected } from "@/app/api/activities/shared";
import { discardRunningActivity, updateRunningActivityStart } from "@/services/activity/running";

type Body = {
  startedAt?: string;
  /** 直す記録の開始時刻・項目名（issue #974）。違う記録なら直さず409を返す。 */
  expectedStartedAt?: string;
  expectedTitle?: string;
};

/**
 * 進行中の記録の開始時刻を直す（docs/spec.md §27）。
 *
 * 記録は始めるときに押すものだが、押し忘れて後から気付くほうが多い。
 * ここで直せないと、いったん止めてGoogle側で予定を直すことになる。
 */
export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { startedAt, expectedStartedAt, expectedTitle } = (await request.json()) as Body;
  const parsed = startedAt ? new Date(startedAt) : null;

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return NextResponse.json({ error: "startedAt is required" }, { status: 400 });
  }

  const expected = parseExpected(expectedStartedAt, expectedTitle);
  if (expected === null) {
    return NextResponse.json({ error: "expectedStartedAt is invalid" }, { status: 400 });
  }

  try {
    const running = await updateRunningActivityStart(userId, parsed, expected);
    if (!running) {
      return NextResponse.json({ error: "not_running" }, { status: 404 });
    }

    return NextResponse.json({ running });
  } catch (error) {
    // 未来の時刻は開始・停止と同じ判定で断る（サービス側の resolveRecordTime）。
    const conflict = activityConflictResponse(error);
    if (conflict) return conflict;
    throw error;
  }
}

/** 進行中の記録を、予定にせず取り消す。押し間違えて始めた記録を残さないため。 */
export async function DELETE(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const expected = parseExpected(params.get("expectedStartedAt"), params.get("expectedTitle"));
  if (expected === null) {
    return NextResponse.json({ error: "expectedStartedAt is invalid" }, { status: 400 });
  }

  let discarded: boolean;
  try {
    discarded = await discardRunningActivity(userId, expected);
  } catch (error) {
    const conflict = activityConflictResponse(error);
    if (conflict) return conflict;
    throw error;
  }
  if (!discarded) {
    return NextResponse.json({ error: "not_running" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
