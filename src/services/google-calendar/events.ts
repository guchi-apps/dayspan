import type { GoogleAccount } from "@prisma/client";

import type { CalendarEventItem } from "@/types/calendar";

import { googleCalendarFetch } from "./calendars";

type GoogleEventDateTime = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

type GoogleEventAttendee = { email?: string; displayName?: string; responseStatus?: string };

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  attendees?: GoogleEventAttendee[];
  recurringEventId?: string;
};

type EventsResponse = {
  items?: GoogleEvent[];
  nextPageToken?: string;
};

/**
 * 指定期間の予定を取得する。繰り返し予定は singleEvents で個別の回へ展開させ、
 * 表示側が繰り返し規則を解釈しなくて済むようにする（docs/spec.md §7）。
 */
export async function listEvents(
  account: GoogleAccount,
  calendar: { calendarId: string; name: string; color: string | null },
  range: { timeMin: string; timeMax: string },
): Promise<CalendarEventItem[]> {
  const events: CalendarEventItem[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      timeMin: range.timeMin,
      timeMax: range.timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const page = await googleCalendarFetch<EventsResponse>(
      account,
      `/calendars/${encodeURIComponent(calendar.calendarId)}/events?${params.toString()}`,
    );

    for (const event of page.items ?? []) {
      // キャンセルされた回（繰り返しの例外削除など）は表示しない。
      if (event.status === "cancelled") continue;

      const normalized = normalizeEvent(event, calendar);
      if (normalized) events.push(normalized);
    }

    pageToken = page.nextPageToken;
  } while (pageToken);

  return events;
}

function normalizeEvent(
  event: GoogleEvent,
  calendar: { calendarId: string; name: string; color: string | null },
): CalendarEventItem | null {
  const start = event.start;
  const end = event.end;
  if (!start || !end) return null;

  const allDay = Boolean(start.date);

  if (allDay) {
    if (!start.date || !end.date) return null;
    // Google の終日予定の end.date は「翌日」（排他）。表示では最終日を含めたいので1日戻す。
    const lastDay = new Date(`${end.date}T00:00:00Z`);
    lastDay.setUTCDate(lastDay.getUTCDate() - 1);

    return {
      kind: "event",
      id: event.id,
      calendarId: calendar.calendarId,
      calendarName: calendar.name,
      title: event.summary?.trim() || "(タイトルなし)",
      allDay: true,
      start: start.date,
      end: lastDay.toISOString().slice(0, 10),
      location: event.location ?? null,
      description: event.description ?? null,
      attendees: (event.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
      recurring: Boolean(event.recurringEventId),
      color: calendar.color,
      url: event.htmlLink ?? null,
    };
  }

  if (!start.dateTime || !end.dateTime) return null;

  return {
    kind: "event",
    id: event.id,
    calendarId: calendar.calendarId,
    calendarName: calendar.name,
    title: event.summary?.trim() || "(タイトルなし)",
    allDay: false,
    start: start.dateTime,
    end: end.dateTime,
    location: event.location ?? null,
    description: event.description ?? null,
    attendees: (event.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
    recurring: Boolean(event.recurringEventId),
    color: calendar.color,
    url: event.htmlLink ?? null,
  };
}

// --- 予定の作成・更新・削除 ---

export type EventWriteInput = {
  title: string;
  allDay: boolean;
  /** allDay のときは YYYY-MM-DD、それ以外は ISO 8601 */
  start: string;
  /** allDay のときは YYYY-MM-DD（終了日を含む）、それ以外は ISO 8601 */
  end: string;
  location?: string | null;
  description?: string | null;
  attendees?: string[];
  /** 例: "RRULE:FREQ=WEEKLY"。繰り返さない場合は null */
  recurrenceRule?: string | null;
  timeZone: string;
};

function toRequestBody(input: EventWriteInput) {
  const start = input.allDay
    ? { date: input.start }
    : { dateTime: input.start, timeZone: input.timeZone };

  // Google の終日予定の end.date は排他（翌日）。表示側は最終日を含む形で扱っているので戻す。
  const endDate = new Date(`${input.end}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);

  const end = input.allDay
    ? { date: endDate.toISOString().slice(0, 10) }
    : { dateTime: input.end, timeZone: input.timeZone };

  return {
    summary: input.title,
    start,
    end,
    location: input.location ?? undefined,
    description: input.description ?? undefined,
    attendees: input.attendees?.length ? input.attendees.map((email) => ({ email })) : undefined,
    recurrence: input.recurrenceRule ? [input.recurrenceRule] : undefined,
  };
}

export async function createEvent(
  account: GoogleAccount,
  calendarId: string,
  input: EventWriteInput,
): Promise<{ id: string }> {
  const created = await googleCalendarFetch<GoogleEvent>(
    account,
    `/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: "POST", body: JSON.stringify(toRequestBody(input)) },
  );

  return { id: created.id };
}

/**
 * 予定を更新する。繰り返し予定の1回分を対象にした場合、この回だけが変更される
 * （Google Calendar APIの仕様。シリーズ全体の変更は扱わない）。
 */
export async function updateEvent(
  account: GoogleAccount,
  calendarId: string,
  eventId: string,
  input: EventWriteInput,
): Promise<void> {
  const body = toRequestBody(input);
  // 繰り返し規則の変更はシリーズ全体に及ぶため、更新では送らない。
  delete (body as { recurrence?: unknown }).recurrence;

  await googleCalendarFetch(
    account,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export async function deleteEvent(
  account: GoogleAccount,
  calendarId: string,
  eventId: string,
): Promise<void> {
  await googleCalendarFetch(
    account,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
}
