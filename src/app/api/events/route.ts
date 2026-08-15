import { NextResponse } from "next/server";

import { calendarWriteError, externalApiError } from "@/lib/api-error";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createEvent, type EventWriteInput } from "@/services/google-calendar/events";
import { resolveGoogleAccountForCalendar } from "@/services/calendar/write-context";

type Body = Partial<EventWriteInput> & { calendarId?: string };

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Body;
  if (!body.calendarId || !body.title?.trim() || !body.start || !body.end) {
    return NextResponse.json(
      { error: "calendarId, title, start, end are required" },
      { status: 400 },
    );
  }

  const target = await resolveGoogleAccountForCalendar(userId, body.calendarId);
  if (!target.ok) {
    return calendarWriteError(target.reason);
  }

  const uiSetting = await db.uiSetting.findUnique({ where: { userId } });

  try {
    const created = await createEvent(target.account, body.calendarId, {
      title: body.title.trim(),
      allDay: Boolean(body.allDay),
      start: body.start,
      end: body.end,
      location: body.location ?? null,
      description: body.description ?? null,
      attendees: body.attendees ?? [],
      recurrenceRule: body.recurrenceRule ?? null,
      timeZone: uiSetting?.timeZone ?? "Asia/Tokyo",
    });
    return NextResponse.json({ id: created.id });
  } catch (error) {
    return externalApiError("google", "予定の作成", error);
  }
}
