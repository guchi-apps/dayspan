import { NextResponse } from "next/server";

import { calendarWriteError, externalApiError } from "@/lib/api-error";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createEvent, type EventWriteInput } from "@/services/google-calendar/events";
import { getMonthsFetchRange } from "@/lib/calendar-range";
import { loadEventsOnly } from "@/services/calendar/load";
import { resolveGoogleAccountForCalendar } from "@/services/calendar/write-context";

type Body = Partial<EventWriteInput> & { calendarId?: string };

/**
 * 指定した月の予定だけを返す（`?month=YYYY-MM`）。タスクの入力画面で紐づける予定を選ぶために使う
 * （issue #802）。活動記録の保存先カレンダーの予定は除く（issue #809）。タスク・日付リマインドなどNotionの項目は読まない。
 */
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: "month is required" }, { status: 400 });
  }

  const data = await loadEventsOnly(userId, getMonthsFetchRange([month]));

  return NextResponse.json(data);
}

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
      tentative: body.tentative ?? false,
    });
    return NextResponse.json({ id: created.id });
  } catch (error) {
    return externalApiError("google", "予定の作成", error);
  }
}
