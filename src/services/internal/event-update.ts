import { isoToLocalInput, localInputToIso } from "@/components/calendar/datetime-fields";
import type { EventWriteInput, GoogleEvent } from "@/services/google-calendar/events";
import type { InternalUpdateEventRequest } from "@/types/internal-api";

const TIME_KEY = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export type MergeResult =
  | { ok: true; input: EventWriteInput }
  | { ok: false; status: 400 | 409; error: string; message?: string };

/**
 * 既存の予定へ、送られた項目だけを重ねて更新の入力を作る（`PATCH /api/internal/events/[id]`）。
 *
 * 送られなかった項目は今の値のまま。日をまたぐ予定・複数日の終日予定は、`date` + `startTime` /
 * `endTime` の形では表せず、黙って1日へ縮めてしまうため断る。繰り返しの親（シリーズ全体を
 * 指すID）も、1回の更新がシリーズ全体へ及ぶため断る。
 */
export function mergeInternalEventUpdate(
  existing: GoogleEvent,
  body: InternalUpdateEventRequest,
  timeZone: string,
): MergeResult {
  if (existing.recurrence?.length) {
    return {
      ok: false,
      status: 409,
      error: "recurring_master_unsupported",
      message: "繰り返しの元の予定（シリーズ全体）は更新できません。1回分のIDを指定してください。",
    };
  }

  const startValue = existing.start?.date ?? existing.start?.dateTime;
  const endValue = existing.end?.date ?? existing.end?.dateTime;
  if (!startValue || !endValue) {
    return { ok: false, status: 409, error: "event_without_time" };
  }

  const currentAllDay = Boolean(existing.start?.date);
  let currentDate: string;
  let currentStartTime: string | null = null;
  let currentEndTime: string | null = null;

  if (currentAllDay) {
    currentDate = startValue;
    // end.date は排他（翌日）。1日ぶんの終日だけ扱う。
    const next = new Date(`${startValue}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    if (next.toISOString().slice(0, 10) !== endValue) {
      return multiDay();
    }
  } else {
    const [startDate, startTime] = isoToLocalInput(startValue, timeZone).split("T");
    const [endDate, endTime] = isoToLocalInput(endValue, timeZone).split("T");
    if (startDate !== endDate) return multiDay();
    currentDate = startDate;
    currentStartTime = startTime;
    currentEndTime = endTime;
  }

  const title = body.title !== undefined ? body.title?.trim() : (existing.summary ?? "");
  if (!title) {
    return { ok: false, status: 400, error: "title must not be empty" };
  }

  const date = body.date ?? currentDate;
  if (!DATE_KEY.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
    return { ok: false, status: 400, error: "date must be a valid date in YYYY-MM-DD format" };
  }

  const hasStart = body.startTime != null;
  const hasEnd = body.endTime != null;
  if (hasStart !== hasEnd) {
    return {
      ok: false,
      status: 400,
      error: "startTime and endTime must be specified together",
    };
  }
  if (body.allDay === true && hasStart) {
    return { ok: false, status: 400, error: "allDay cannot be combined with startTime/endTime" };
  }

  const allDay = body.allDay === true ? true : hasStart ? false : currentAllDay && body.allDay !== false;
  let startTime: string | null = null;
  let endTime: string | null = null;

  if (!allDay) {
    startTime = hasStart ? body.startTime! : currentStartTime;
    endTime = hasEnd ? body.endTime! : currentEndTime;
    if (!startTime || !endTime) {
      return {
        ok: false,
        status: 400,
        error: "startTime and endTime are required to change an all-day event to a timed one",
      };
    }
    if (!TIME_KEY.test(startTime) || !TIME_KEY.test(endTime)) {
      return { ok: false, status: 400, error: "startTime and endTime must be in HH:MM format" };
    }
    if (endTime <= startTime) {
      return { ok: false, status: 400, error: "endTime must be after startTime" };
    }
  }

  return {
    ok: true,
    input: {
      title,
      allDay,
      start: allDay ? date : localInputToIso(`${date}T${startTime}`, timeZone),
      end: allDay ? date : localInputToIso(`${date}T${endTime}`, timeZone),
      location: body.location !== undefined ? (body.location ?? "").trim() : undefined,
      timeZone,
      tentative: body.tentative,
    },
  };
}

function multiDay(): MergeResult {
  return {
    ok: false,
    status: 409,
    error: "multi_day_event_unsupported",
    message: "日をまたぐ予定・複数日の予定はこの入口では更新できません。",
  };
}
