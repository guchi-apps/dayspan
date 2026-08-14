import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import {
  discardRunningActivity,
  updateRunningActivityStart,
} from "@/services/activity/running";

type Body = { startedAt?: string };

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

  const { startedAt } = (await request.json()) as Body;
  const parsed = startedAt ? new Date(startedAt) : null;

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return NextResponse.json({ error: "startedAt is required" }, { status: 400 });
  }

  const running = await updateRunningActivityStart(userId, parsed);
  if (!running) {
    return NextResponse.json(
      { error: "not_updatable", message: "記録中の項目が無いか、開始時刻が未来です。" },
      { status: 400 },
    );
  }

  return NextResponse.json({ running });
}

/** 進行中の記録を、予定にせず取り消す。押し間違えて始めた記録を残さないため。 */
export async function DELETE() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const discarded = await discardRunningActivity(userId);
  if (!discarded) {
    return NextResponse.json({ error: "not_running" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
