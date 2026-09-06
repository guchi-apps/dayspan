import type { EventOutcome } from "@prisma/client";

import { db } from "@/lib/db";
import type { CalendarEventItem, EventOutcomeItem, EventOutcomeKind } from "@/types/calendar";

/**
 * 予定の中止・不参加の記録（docs/spec.md §37）。
 *
 * 行かなかった予定を消すと、その日に何があったのかまで消える。予定はカレンダーに残したまま
 * 「起こらなかった」の一段だけを足す。
 *
 * 本体はDaySpanのDBに置く。Google Calendarには「中止だが残す」欄が無く、
 * `status: cancelled` は削除相当で予定そのものが消える。出欠（`responseStatus`）は招待された
 * 予定にしか無い。タイトル・説明へ「【中止】」と書き足すと、記録を外したあとも文字列が残り、
 * 外部で編集されたときに壊れる。移動（TravelPlan）・タスクの紐づけ（TaskEventLink）と同じく、
 * 相手のDBに欄が無いものは線だけをDaySpanが持つ。
 */

/** 理由の上限。TEXT列だが、画面へ流す値なので現実的な長さで切る。 */
const NOTE_LIMIT = 2000;

export type EventOutcomeInput = {
  calendarId: string;
  eventId: string;
  kind: EventOutcomeKind;
  note?: string | null;
};

/**
 * この利用者の記録をすべて引く。
 *
 * 範囲で絞らないのは、`eventId` からは日付が引けないため。中止・不参加は稀にしか起きず、
 * 件数は現実的に増えない（`listTaskLinks()` と同じ扱い）。DaySpanのDBのみのため、
 * 外部APIへの往復は増えない。
 */
export async function listEventOutcomes(userId: string): Promise<EventOutcome[]> {
  return db.eventOutcome.findMany({ where: { userId } });
}

export async function getEventOutcome(
  userId: string,
  eventId: string,
): Promise<EventOutcome | null> {
  return db.eventOutcome.findUnique({ where: { userId_eventId: { userId, eventId } } });
}

/** DBの行を画面が扱う形へ。 */
export function toEventOutcomeItem(outcome: EventOutcome): EventOutcomeItem {
  return { kind: outcome.kind, note: outcome.note };
}

/**
 * 取得した予定へ記録を付ける。記録の無い予定は `toCalendarItems()` が入れた null のまま残す。
 */
export function attachEventOutcomes(
  events: CalendarEventItem[],
  outcomes: EventOutcome[],
): CalendarEventItem[] {
  if (outcomes.length === 0) return events;

  const byEventId = new Map(outcomes.map((outcome) => [outcome.eventId, outcome]));

  return events.map((event) => {
    const outcome = byEventId.get(event.id);
    return outcome ? { ...event, outcome: toEventOutcomeItem(outcome) } : event;
  });
}

/**
 * 記録を付ける・付け替える。予定1件につき1つのため、種類を選び直したら上書きになる。
 * 記録はGoogleへ書き込まないため、「使用」がオフのカレンダーの予定にも付けられる
 * （タスクの紐づけと同じ判断）。
 */
export async function setEventOutcome(
  userId: string,
  input: EventOutcomeInput,
): Promise<EventOutcome> {
  const note = normalizeNote(input.note);

  return db.eventOutcome.upsert({
    where: { userId_eventId: { userId, eventId: input.eventId } },
    create: {
      userId,
      calendarId: input.calendarId,
      eventId: input.eventId,
      kind: input.kind,
      note,
    },
    // カレンダーは予定を移すと変わる。記録は予定IDで引くため、写しのほうを合わせる。
    update: { calendarId: input.calendarId, kind: input.kind, note },
  });
}

/** 記録を外す。消えるのは記録の一段だけで、予定は残る。 */
export async function clearEventOutcome(userId: string, eventId: string): Promise<number> {
  const result = await db.eventOutcome.deleteMany({ where: { userId, eventId } });
  return result.count;
}

/**
 * 予定を消したときに、その予定に付いていた記録も消す（指す先が無くなるため）。
 *
 * 繰り返しの範囲指定は `dropLinksForEvent()`（services/task-links/links.ts）と同じ扱いにする。
 * 回のIDは `<親のID>_YYYYMMDDTHHMMSSZ` で桁が揃っているため、文字列の大小で前後を比べられる。
 */
export async function dropOutcomesForEvent(
  userId: string,
  eventId: string,
  scope: "single" | "following" | "all",
): Promise<number> {
  const separator = eventId.indexOf("_");

  if (scope === "single" || separator < 0) {
    const result = await db.eventOutcome.deleteMany({ where: { userId, eventId } });
    return result.count;
  }

  const prefix = `${eventId.slice(0, separator)}_`;
  const result = await db.eventOutcome.deleteMany({
    where: {
      userId,
      eventId: scope === "all" ? { startsWith: prefix } : { startsWith: prefix, gte: eventId },
    },
  });

  return result.count;
}

function normalizeNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim();
  if (!trimmed) return null;
  return trimmed.length > NOTE_LIMIT ? trimmed.slice(0, NOTE_LIMIT) : trimmed;
}
