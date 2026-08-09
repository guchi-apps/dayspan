import type { GoogleAccount } from "@prisma/client";

import { getValidAccessToken } from "./tokens";

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

export type GoogleCalendarListEntry = {
  id: string;
  summary: string;
  summaryOverride?: string;
  description?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  primary?: boolean;
  selected?: boolean;
  accessRole: string;
  timeZone?: string;
};

type CalendarListResponse = {
  items?: GoogleCalendarListEntry[];
  nextPageToken?: string;
};

export async function googleCalendarFetch<T>(
  account: GoogleAccount,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const accessToken = await getValidAccessToken(account);

  const response = await fetch(`${CALENDAR_API_BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    // 予定は外部が一次情報源のため、Next.jsのfetchキャッシュには載せない。
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google Calendar API ${path} returned ${response.status}: ${detail}`);
  }

  // 削除は 204 No Content を返す。空の本文をJSONとして読むと例外になるため分岐する。
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** ユーザーが参照できるカレンダーを全ページ取得する。 */
export async function listCalendars(account: GoogleAccount): Promise<GoogleCalendarListEntry[]> {
  const calendars: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({ maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);

    const page = await googleCalendarFetch<CalendarListResponse>(
      account,
      `/users/me/calendarList?${params.toString()}`,
    );

    calendars.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return calendars;
}

/** カレンダーの表示名。ユーザーが個別に名前を上書きしている場合はそちらを優先する。 */
export function calendarDisplayName(calendar: GoogleCalendarListEntry): string {
  return calendar.summaryOverride?.trim() || calendar.summary;
}
