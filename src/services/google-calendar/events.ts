import type { GoogleAccount } from "@prisma/client";

import type { CalendarEventItem } from "@/types/calendar";

import { googleCalendarFetch } from "./calendars";

type GoogleEventDateTime = {
  date?: string;
  dateTime?: string;
  timeZone?: string;
};

type GoogleEventAttendee = { email?: string; displayName?: string; responseStatus?: string };

export type GoogleEvent = {
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
  /** 繰り返しの1回分で、その回が本来始まるはずだった日時。回ごと動かしていても元の位置が分かる。 */
  originalStartTime?: GoogleEventDateTime;
  /** 繰り返し予定の親が持つ規則（RRULE・EXDATE など）。1回分の応答には含まれない。 */
  recurrence?: string[];
};

type EventsResponse = {
  items?: GoogleEvent[];
  nextPageToken?: string;
};

/** 表示に必要なカレンダーの情報。一次情報源は calendarList 側にある。 */
export type CalendarDisplay = {
  calendarId: string;
  name: string;
  color: string | null;
  /** このカレンダーへ書き込めないかどうか。使用オフ、または読み取り専用の共有。 */
  readOnly: boolean;
};

/**
 * 指定期間の予定を取得する。繰り返し予定は singleEvents で個別の回へ展開させ、
 * 表示側が繰り返し規則を解釈しなくて済むようにする（docs/spec.md §7）。
 *
 * カレンダー名と色はここでは扱わない。それらは calendarList の応答が要るため、
 * 待ち合わせると往復が直列に積み上がる。呼び出し側が両者を並行に取得し、
 * あとから toCalendarItems() で突き合わせる。
 */
export async function listEvents(
  account: GoogleAccount,
  calendarId: string,
  range: { timeMin: string; timeMax: string },
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
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
      `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
    );

    for (const event of page.items ?? []) {
      // キャンセルされた回（繰り返しの例外削除など）は表示しない。
      if (event.status === "cancelled") continue;
      events.push(event);
    }

    pageToken = page.nextPageToken;
  } while (pageToken);

  return events;
}

/** Googleの応答とカレンダーの表示情報を突き合わせて、画面が扱う形に変換する。 */
export function toCalendarItems(
  events: GoogleEvent[],
  calendar: CalendarDisplay,
): CalendarEventItem[] {
  const items: CalendarEventItem[] = [];

  for (const event of events) {
    const normalized = normalizeEvent(event, calendar);
    if (normalized) items.push(normalized);
  }

  return items;
}

function normalizeEvent(event: GoogleEvent, calendar: CalendarDisplay): CalendarEventItem | null {
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
      readOnly: calendar.readOnly,
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
    readOnly: calendar.readOnly,
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
  if (!input.start || !input.end) {
    throw new Error("開始日時と終了日時を入力してください。");
  }

  const start = input.allDay
    ? { date: input.start }
    : { dateTime: input.start, timeZone: input.timeZone };

  const end = input.allDay
    ? { date: exclusiveEndDate(input.end) }
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

/** Google の終日予定の end.date は排他（翌日）。表示側は最終日を含む形で扱うので1日進める。 */
function exclusiveEndDate(lastDay: string): string {
  const date = new Date(`${lastDay}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`終了日の形式が不正です: ${lastDay}`);
  }
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
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

/**
 * 繰り返し予定を削除する範囲。Google Calendarの画面と同じ3通りにする。
 * 繰り返さない予定では "single" しか使わない。
 */
export type EventDeleteScope = "single" | "following" | "all";

const EVENT_DELETE_SCOPES: string[] = ["single", "following", "all"];

export function isEventDeleteScope(value: string): value is EventDeleteScope {
  return EVENT_DELETE_SCOPES.includes(value);
}

/**
 * 削除範囲を指定して予定を消す。
 *
 * 画面に出ている繰り返し予定は singleEvents で展開した1回分で、そのIDを消しても
 * その回しか消えない。シリーズ全体・これ以降は親の予定を触る必要があるため、
 * ここで親を引き当ててから範囲ごとに操作を分ける。
 */
export async function deleteEventWithScope(
  account: GoogleAccount,
  calendarId: string,
  eventId: string,
  scope: EventDeleteScope,
): Promise<void> {
  if (scope === "single") {
    await deleteEvent(account, calendarId, eventId);
    return;
  }

  const instance = await getEvent(account, calendarId, eventId);
  const masterId = instance.recurringEventId;

  // 繰り返しでない予定に範囲を指定された場合。消す対象はその予定しかない。
  if (!masterId) {
    await deleteEvent(account, calendarId, eventId);
    return;
  }

  if (scope === "all") {
    await deleteEvent(account, calendarId, masterId);
    return;
  }

  await endSeriesBefore(account, calendarId, masterId, instance);
}

async function getEvent(
  account: GoogleAccount,
  calendarId: string,
  eventId: string,
): Promise<GoogleEvent> {
  return googleCalendarFetch<GoogleEvent>(
    account,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  );
}

/**
 * この回から先を繰り返しの対象から外す。親のRRULEへ、この回の直前までのUNTILを入れる。
 * 回ごと動かしている場合は動かした先ではなく本来の位置（originalStartTime）を境目にする。
 * 動かした先を基準にすると、まだ消したくない回まで範囲に入ってしまうため。
 */
async function endSeriesBefore(
  account: GoogleAccount,
  calendarId: string,
  masterId: string,
  instance: GoogleEvent,
): Promise<void> {
  const boundary = instance.originalStartTime ?? instance.start;
  const master = await getEvent(account, calendarId, masterId);

  // 1回目から先を消すと1回も残らない。空のシリーズを作らず、親ごと消す。
  if (!boundary || !startsBefore(master.start, boundary)) {
    await deleteEvent(account, calendarId, masterId);
    return;
  }

  const until = untilBefore(boundary);
  const rules = master.recurrence ?? [];
  const truncated = rules.map((rule) =>
    /^RRULE:/i.test(rule) ? withUntil(rule, until) : rule,
  );

  // RRULEを持たない（RDATEだけで組まれている等）親は範囲を縮められない。まるごと消す。
  if (truncated.every((rule, index) => rule === rules[index])) {
    await deleteEvent(account, calendarId, masterId);
    return;
  }

  await googleCalendarFetch(
    account,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(masterId)}`,
    { method: "PATCH", body: JSON.stringify({ recurrence: truncated }) },
  );
}

/** 開始日時の前後比較。終日は日付、時刻ありはISO 8601で入っており、型が揃わないことがある。 */
function startsBefore(a: GoogleEventDateTime | undefined, b: GoogleEventDateTime): boolean {
  const left = toComparable(a);
  const right = toComparable(b);
  if (left === null || right === null) return false;
  return left < right;
}

function toComparable(value: GoogleEventDateTime | undefined): number | null {
  const iso = value?.dateTime ?? (value?.date ? `${value.date}T00:00:00Z` : null);
  if (!iso) return null;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * この回を含めないUNTILの値。RFC 5545ではDTSTARTの型と揃っている必要があるため、
 * 終日は前日の日付、時刻ありはその1秒前をUTCの日時にする。
 */
function untilBefore(boundary: GoogleEventDateTime): string {
  if (boundary.date) {
    const date = new Date(`${boundary.date}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10).replace(/-/g, "");
  }

  const date = new Date(boundary.dateTime ?? "");
  if (Number.isNaN(date.getTime())) {
    throw new Error(`予定の開始日時を解釈できませんでした: ${boundary.dateTime}`);
  }
  date.setUTCSeconds(date.getUTCSeconds() - 1);
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** RRULEの終わり方をUNTILへ置き換える。UNTILとCOUNTは併記できないため既存の指定は外す。 */
function withUntil(rule: string, until: string): string {
  const body = rule.replace(/^RRULE:/i, "");
  const parts = body
    .split(";")
    .filter((part) => part && !/^(UNTIL|COUNT)=/i.test(part));
  parts.push(`UNTIL=${until}`);
  return `RRULE:${parts.join(";")}`;
}

/**
 * 予定の保存先カレンダーを変更する。PATCHではカレンダーを跨げないため、
 * Google Calendar APIの move を使う（送信元・送信先とも同じGoogleアカウントである必要がある）。
 */
export async function moveEvent(
  account: GoogleAccount,
  calendarId: string,
  eventId: string,
  destinationCalendarId: string,
): Promise<void> {
  await googleCalendarFetch(
    account,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/move?destination=${encodeURIComponent(destinationCalendarId)}`,
    { method: "POST" },
  );
}
