import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { deleteEvent, updateEvent, type EventWriteInput } from "@/services/google-calendar/events";
import { resolveGoogleAccountForCalendar } from "@/services/calendar/write-context";

type Body = Partial<EventWriteInput> & { calendarId?: string };

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

  const account = await resolveGoogleAccountForCalendar(userId, body.calendarId);
  if (!account) {
    return NextResponse.json({ error: "calendar_not_found" }, { status: 404 });
  }

  const uiSetting = await db.uiSetting.findUnique({ where: { userId } });

  try {
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
  } catch {
    return NextResponse.json({ error: "google_request_failed" }, { status: 502 });
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
  const calendarId = new URL(request.url).searchParams.get("calendarId");
  if (!calendarId) {
    return NextResponse.json({ error: "calendarId is required" }, { status: 400 });
  }

  const account = await resolveGoogleAccountForCalendar(userId, calendarId);
  if (!account) {
    return NextResponse.json({ error: "calendar_not_found" }, { status: 404 });
  }

  try {
    await deleteEvent(account, calendarId, eventId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "google_request_failed" }, { status: 502 });
  }
}
