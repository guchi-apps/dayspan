import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import {
  clearEventOutcome,
  setEventOutcome,
  toEventOutcomeItem,
} from "@/services/calendar/event-outcomes";
import { isEventOutcomeKind } from "@/types/calendar";

/**
 * 予定の中止・不参加の記録（docs/spec.md §37）。
 *
 * `resolveGoogleAccountForCalendar()` は通さない。記録はGoogleへ書き込まないため、
 * 「使用」がオフのカレンダーの予定にも付けられてよい（タスクの紐づけと同じ判断）。
 */

type Body = {
  calendarId?: string;
  kind?: string;
  note?: string | null;
};

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { eventId } = await params;
  const body = (await request.json()) as Body;

  if (!body.calendarId) {
    return NextResponse.json(
      { error: "invalid_request", message: "calendarId は必須です。" },
      { status: 400 },
    );
  }

  // 種類は画面でも選ばせているが、DaySpanのAPIや将来のMCPから直接呼ばれた要求は画面を
  // 通らない（docs/spec.md §22）。ここでも同じ条件で断る。
  if (!isEventOutcomeKind(body.kind)) {
    return NextResponse.json(
      { error: "invalid_request", message: "中止か不参加かを選んでください。" },
      { status: 400 },
    );
  }

  const outcome = await setEventOutcome(userId, {
    calendarId: body.calendarId,
    eventId,
    kind: body.kind,
    note: body.note ?? null,
  });

  return NextResponse.json({ ok: true, outcome: toEventOutcomeItem(outcome) });
}

/** 記録を外す。消えるのは記録の一段だけで、予定はカレンダーに残る。 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { eventId } = await params;
  await clearEventOutcome(userId, eventId);

  return NextResponse.json({ ok: true });
}
