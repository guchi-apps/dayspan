import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import {
  deleteEventWithScope,
  isEventDeleteScope,
  moveEvent,
  updateEvent,
  type EventWriteInput,
} from "@/services/google-calendar/events";
import { resolveGoogleAccountForCalendar } from "@/services/calendar/write-context";

type Body = Partial<EventWriteInput> & { calendarId?: string; previousCalendarId?: string };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { eventId } = await params;
  const body = (await request.json()) as Body;

  if (!body.calendarId || !body.title?.trim() || !body.start || !body.end) {
    return NextResponse.json(
      { error: "calendarId, title, start, end are required" },
      { status: 400 },
    );
  }

  const moving = Boolean(body.previousCalendarId) && body.previousCalendarId !== body.calendarId;
  const sourceCalendarId = moving ? body.previousCalendarId! : body.calendarId;

  const account = await resolveGoogleAccountForCalendar(userId, sourceCalendarId);
  if (!account) {
    return NextResponse.json({ error: "calendar_not_found" }, { status: 404 });
  }

  if (moving) {
    const destinationAccount = await resolveGoogleAccountForCalendar(userId, body.calendarId);
    if (!destinationAccount) {
      return NextResponse.json({ error: "calendar_not_found" }, { status: 404 });
    }
    if (destinationAccount.id !== account.id) {
      return NextResponse.json(
        {
          error: "cross_account_move_unsupported",
          message: "異なるGoogleアカウントのカレンダーへは移動できません。",
        },
        { status: 400 },
      );
    }
  }

  const uiSetting = await db.uiSetting.findUnique({ where: { userId } });

  try {
    if (moving) {
      // moveはカレンダーのみを変える。他の項目は移動後に、移動先カレンダーへ改めて反映する。
      await moveEvent(account, sourceCalendarId, eventId, body.calendarId);
    }
    await updateEvent(account, body.calendarId, eventId, {
      title: body.title.trim(),
      allDay: Boolean(body.allDay),
      start: body.start,
      end: body.end,
      location: body.location ?? null,
      description: body.description ?? null,
      attendees: body.attendees ?? [],
      timeZone: uiSetting?.timeZone ?? "Asia/Tokyo",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return externalApiError("google", moving ? "予定のカレンダー移動" : "予定の更新", error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { eventId } = await params;
  const searchParams = new URL(request.url).searchParams;
  const calendarId = searchParams.get("calendarId");
  if (!calendarId) {
    return NextResponse.json({ error: "calendarId is required" }, { status: 400 });
  }

  // 繰り返し予定はどこまで消すかで操作が変わる。指定が無いときはこの回だけに留める。
  const requestedScope = searchParams.get("scope");
  if (requestedScope !== null && !isEventDeleteScope(requestedScope)) {
    return NextResponse.json({ error: "invalid_scope" }, { status: 400 });
  }
  const scope = requestedScope ?? "single";

  const account = await resolveGoogleAccountForCalendar(userId, calendarId);
  if (!account) {
    return NextResponse.json({ error: "calendar_not_found" }, { status: 404 });
  }

  try {
    await deleteEventWithScope(account, calendarId, eventId, scope);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return externalApiError("google", "予定の削除", error);
  }
}
