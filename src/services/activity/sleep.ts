import { localInputToIso } from "@/components/calendar/datetime-fields";
import { externalApiMessage } from "@/lib/api-error";
import { db } from "@/lib/db";
import { addDays, parseDateKey, toDateKey } from "@/lib/calendar-range";
import { getActivityCalendarId } from "@/services/activity/settings";
import { listEvents, type GoogleEvent } from "@/services/google-calendar/events";

/**
 * 睡眠の横通し表示のために、活動記録の保存先カレンダーを読む（docs/spec.md §39）。
 *
 * 作りは `services/activity/summary.ts` の `loadTodayTotals()` と揃えてある。
 * 読むのは保存先カレンダー1つだけで、外部APIへの往復は画面1回につき1回（docs/spec.md §20）。
 */

/** 読めなかった理由。画面に「何を設定すればここが使えるのか」まで出すために分ける。 */
export type SleepLoadUnavailable = "calendar_not_selected" | "google_unavailable";

export type SleepLoadResult =
  | { ok: true; events: GoogleEvent[] }
  | { ok: false; reason: SleepLoadUnavailable; message: string | null };

/**
 * 並べる夜の日付キー（古い順）を作る。1行は12:00から翌12:00のため、
 * 今日の12:00を過ぎていなくても「今夜」の行は今日のキーになる。
 */
export function sleepNightKeys(todayKey: string, days: number): string[] {
  const last = parseDateKey(todayKey);
  return Array.from({ length: days }, (_, i) => toDateKey(addDays(last, i - (days - 1))));
}

/**
 * 夜の範囲にかかる記録を取りにいく。
 *
 * 集計できるのは記録の保存先カレンダーを指定しているときだけ。未指定の記録は予定作成の
 * 既定のカレンダーへ入るが（running.ts の resolveActivityCalendarId）、そこには普通の予定も
 * 混ざるため、どれが記録なのか区別できない（docs/spec.md §27 と同じ理由）。
 */
export async function loadSleepEvents(
  userId: string,
  input: { nightKeys: string[]; timeZone: string },
): Promise<SleepLoadResult> {
  const { nightKeys, timeZone } = input;

  const first = nightKeys[0];
  const last = nightKeys[nightKeys.length - 1];
  if (!first || !last) return { ok: true, events: [] };

  const calendarId = await getActivityCalendarId(userId);
  if (!calendarId) return { ok: false, reason: "calendar_not_selected", message: null };

  // 読み取りに resolveGoogleAccountForCalendar() は使わない。あれは書き込み用で writeEnabled を
  // 要求するため、「使用」をオフにしたあとに過去の記録まで読めなくなる（summary.ts と同じ）。
  const setting = await db.calendarSetting.findFirst({
    where: { userId, calendarId },
    include: { googleAccount: true },
  });
  // 設定したあとにカレンダーを消した・共有を外された場合。選び直せば戻るため、
  // 「保存先が決まっていない」と同じ扱いにする。
  if (!setting) return { ok: false, reason: "calendar_not_selected", message: null };

  // 先頭の夜の12:00から、最後の夜の終わり（翌12:00）まで。日をまたぐ記録は
  // Googleが範囲に重なるものを返すため、両端で切れている記録もここに含まれる。
  const timeMin = localInputToIso(`${first}T12:00`, timeZone);
  const timeMax = localInputToIso(`${toDateKey(addDays(parseDateKey(last), 1))}T12:00`, timeZone);

  try {
    return { ok: true, events: await listEvents(setting.googleAccount, calendarId, { timeMin, timeMax }) };
  } catch (error) {
    // 握りつぶさない。externalApiMessage() がサーバーログへ全文を残し、画面へ出せる形に縮める
    // （CLAUDE.md「外部APIの扱い」）。画面そのものは開いたままにする（issue #402）。
    return {
      ok: false,
      reason: "google_unavailable",
      message: externalApiMessage("google", "睡眠の記録の取得", error),
    };
  }
}
