import type { GoogleAccount } from "@prisma/client";

import type { CalendarEventItem } from "@/types/calendar";

import { googleCalendarFetch } from "./calendars";

type GoogleEventDateTime = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  htmlLink?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
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
    color: calendar.color,
    url: event.htmlLink ?? null,
  };
}
