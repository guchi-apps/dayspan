import { localInputToIso } from "@/components/calendar/datetime-fields";
import { externalApiMessage } from "@/lib/api-error";
import { db } from "@/lib/db";
import { addDays, parseDateKey, toDateKey } from "@/lib/calendar-range";
import {
  SLEEP_SOURCE_HEALTH,
  SLEEP_SOURCE_PROPERTY,
  planSleepHealthSync,
  selectSleepForHealth,
  sleepHealthEditSince,
  sleepHealthWindowStart,
  type SleepHealthItem,
  type SleepHealthPlan,
  type SleepHealthStaleItem,
} from "@/lib/sleep-health";
import { findOverlappingSleepSpan } from "@/lib/sleep-shortcut";
import {
  ActivityCalendarNotFoundError,
  ActivityTimeRangeError,
  MIN_ACTIVITY_MINUTES,
  resolveActivityCalendarId,
  resolveRecordTime,
} from "@/services/activity/running";
import { getActivityCalendarId, getSleepSettings } from "@/services/activity/settings";
import { getSleepHealthExportedUntil } from "@/services/activity/shortcut-token";
import { listSleepHealthSent } from "@/services/activity/sleep-health-sent";
import { clearTodayEventsCache } from "@/services/activity/today-cache";
import { resolveGoogleAccountForCalendar } from "@/services/calendar/write-context";
import { createEvent, listEvents, type GoogleEvent } from "@/services/google-calendar/events";
import type { ActivitySavedRange } from "@/types/activity";

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

/**
 * iPhoneショートカットから受け取った睡眠を、そのまま予定として書き出す（docs/spec.md §40）。
 *
 * ヘルスケアの睡眠分析（Apple Watch等の実測値）は起床後にまとめて届くため、進行中の記録
 * （`RunningActivity`）を経由しない。押して止めたときと同じく、活動記録の保存先カレンダーへ
 * 項目名のままの予定を1件作る。保存先の決め方も `startActivity()` と同じ
 * `resolveActivityCalendarId()` を通す。ここだけ別の決め方にすると、押して始めた睡眠と
 * ショートカットの睡眠が別のカレンダーへ入りうる。
 */
export type SleepRecordResult =
  | { status: "saved"; range: ActivitySavedRange }
  /** 同じ時間帯の睡眠がすでにある。オートメーションが二重に走ったときはここへ来る。 */
  | { status: "overlapping"; existing: ActivitySavedRange };

export async function recordSleepRange(
  userId: string,
  input: { start: Date; end: Date },
): Promise<SleepRecordResult> {
  // 未来の扱いは押して記録したときと同じ（`resolveRecordTime`）。終わりを先に解くのは、
  // 猶予（60秒）の中で「いま」へ丸められた終わりを基準に開始との前後を見るため。
  const now = new Date();
  const end = resolveRecordTime(input.end, now, "終了");
  const start = resolveRecordTime(input.start, now, "開始");

  if (end.getTime() <= start.getTime()) {
    throw new ActivityTimeRangeError("終了時刻が開始より前です。開始より後の時刻を送ってください。");
  }

  const { title } = await getSleepSettings(userId);

  const calendarId = await resolveActivityCalendarId(userId);
  if (!calendarId) throw new ActivityCalendarNotFoundError();

  const target = await resolveGoogleAccountForCalendar(userId, calendarId);
  if (!target.ok) throw new ActivityCalendarNotFoundError(target.reason);

  // すでに同じ夜の睡眠が入っていないかを確かめる。オートメーションは条件が揃えば何度でも
  // 走るため、確かめずに作ると同じ夜の睡眠が2件並び、`/activity/sleep` の平均も目標に
  // 届かなかった夜の数も倍で出る（docs/spec.md §39）。
  //
  // 読むのは送られてきた時間帯だけで、外部APIへの往復は1回。Googleは範囲に重なる予定を返す
  // ため、両端が範囲の外にある予定もここに含まれる。
  const existing = await listEvents(target.account, calendarId, {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
  });

  const spans: { start: number; end: number; iso: ActivitySavedRange }[] = [];

  for (const event of existing) {
    // 終日の予定は時間帯を持たない。記録は必ず時刻付きで作られるため数えない
    // （`lib/sleep.ts` の buildSleepNights と同じ扱い）。
    if (!event.start?.dateTime || !event.end?.dateTime) continue;
    if ((event.summary ?? "").trim() !== title) continue;

    spans.push({
      start: new Date(event.start.dateTime).getTime(),
      end: new Date(event.end.dateTime).getTime(),
      iso: { start: event.start.dateTime, end: event.end.dateTime },
    });
  }

  // 進行中の睡眠（就寝時のオートメーションで始めたもの）はまだGoogleに無い。
  // これを見ないと、実測値を送ったときに記録中のぶんと重なった2件目ができる。
  const running = await db.runningActivity.findUnique({ where: { userId } });
  if (running && running.title.trim() === title) {
    spans.push({
      start: running.startedAt.getTime(),
      end: now.getTime(),
      iso: { start: running.startedAt.toISOString(), end: now.toISOString() },
    });
  }

  const overlapped = findOverlappingSleepSpan(
    { start: start.getTime(), end: end.getTime() },
    spans,
  );
  if (overlapped) return { status: "overlapping", existing: overlapped.iso };

  // 押して止めたときと同じく、長さの無い予定は作らせず最短の長さまで伸ばす。
  const savedEnd = new Date(
    Math.max(end.getTime(), start.getTime() + MIN_ACTIVITY_MINUTES * 60_000),
  );

  const uiSetting = await db.uiSetting.findUnique({ where: { userId } });

  await createEvent(target.account, calendarId, {
    title,
    allDay: false,
    start: start.toISOString(),
    end: savedEnd.toISOString(),
    timeZone: uiSetting?.timeZone ?? "Asia/Tokyo",
    // ヘルスケアから来た睡眠だと分かる目印。付けないと、ヘルスケアへ送るショートカット
    // （`listSleepForHealth()`）がこれをショートカットを出どころとする2件目として送り返す。
    privateProperties: { [SLEEP_SOURCE_PROPERTY]: SLEEP_SOURCE_HEALTH },
  });

  // ウィジェットの今日の合計は、Googleから取った予定を短時間持ち回して求めている
  // （`stopRunningActivity()` と同じ理由）。
  clearTodayEventsCache(userId);

  return {
    status: "saved",
    range: { start: start.toISOString(), end: savedEnd.toISOString() },
  };
}

/**
 * まだヘルスケアへ送っていない睡眠と、送ったあとに変わった睡眠を選ぶ
 * （docs/spec.md §40「ヘルスケアへ送る」「送ったあとの変更」）。
 *
 * 読むのは活動記録の保存先カレンダー1つで、外部APIへの往復はGoogle 1回（§20）。読み方は
 * `loadSleepEvents()` と揃え、書き込み用の `resolveGoogleAccountForCalendar()` は使わない
 * （「使用」をオフにしたあとも過去の記録は読めるように）。
 *
 * 送り終えた印・送った履歴はここでは進めない。ショートカットが書き終えたあとの POST
 * （`markSleepHealthExported()`・`commitPendingSleepHealth()`）でだけ進める。取得した時点で
 * 進めると、ヘルスケアの書き込み許可を出していない等で途中で止まった夜が二度と返らない。
 */
export type SleepHealthListResult =
  | {
      ok: true;
      /** 追加で送る睡眠。 */
      items: SleepHealthItem[];
      /** ヘルスケアに残る古い時間帯。範囲を指定したときは常に空。 */
      stale: SleepHealthStaleItem[];
      /** 送った履歴との突き合わせの結果。範囲を指定したとき（履歴を見ない）は null。 */
      plan: SleepHealthPlan | null;
      /** 新しい睡眠を探した範囲の始まり（これより後に終わった睡眠を返した）。 */
      after: Date;
      /** 送ったあとの変更を探した範囲の始まり。これより前に終わった履歴は見ない。 */
      editSince: Date;
    }
  | { ok: false; reason: SleepLoadUnavailable; message: string | null };

export async function listSleepForHealth(
  userId: string,
  input: {
    now: Date;
    timeZone: string;
    /**
     * 過去の日を指定して送るときの範囲（`parseSleepHealthRange()`）。あれば印も送った履歴も見ず、
     * その範囲に終わった睡眠を返す。印との関係は route.ts の `until` を参照（一時的な機能・issue #665）。
     */
    range?: { after: Date; before: Date };
  },
): Promise<SleepHealthListResult> {
  const { now, timeZone, range } = input;

  const calendarId = await getActivityCalendarId(userId);
  if (!calendarId) return { ok: false, reason: "calendar_not_selected", message: null };

  const editSince = sleepHealthEditSince(now);

  const [setting, { title }, exportedUntil, sent] = await Promise.all([
    db.calendarSetting.findFirst({
      where: { userId, calendarId },
      include: { googleAccount: true },
    }),
    getSleepSettings(userId),
    range ? Promise.resolve(null) : getSleepHealthExportedUntil(userId),
    range ? Promise.resolve([]) : listSleepHealthSent(userId, editSince),
  ]);
  if (!setting) return { ok: false, reason: "calendar_not_selected", message: null };

  const after = range?.after ?? sleepHealthWindowStart(exportedUntil, now);
  // 範囲の終わりが未来でも、まだ終わっていない睡眠は送らない。
  const windowEnd = range ? new Date(Math.min(now.getTime(), range.before.getTime())) : now;
  // 印より前に終わった睡眠も、送った履歴と突き合わせるために読む。
  const readFrom = range ? after : new Date(Math.min(after.getTime(), editSince.getTime()));

  let events: GoogleEvent[];
  try {
    // Googleは範囲に重なる予定を返す。印より前に始まり後に終わった睡眠もここに含まれる。
    events = await listEvents(setting.googleAccount, calendarId, {
      timeMin: readFrom.toISOString(),
      timeMax: windowEnd.toISOString(),
    });
  } catch (error) {
    return {
      ok: false,
      reason: "google_unavailable",
      message: externalApiMessage("google", "睡眠の記録の取得", error),
    };
  }

  if (range) {
    return {
      ok: true,
      items: selectSleepForHealth(events, { title, after, now: windowEnd, timeZone }),
      stale: [],
      plan: null,
      after,
      editSince,
    };
  }

  const plan = planSleepHealthSync(events, sent, { title, after, editSince, now, timeZone });

  return { ok: true, items: plan.items, stale: plan.stale, plan, after, editSince };
}

/**
 * 睡眠画面のために、送ったあとに変わった睡眠の数を数える（docs/spec.md §40「送ったあとの変更」）。
 *
 * すでに画面が読んでいる予定（`loadSleepEvents()`）と送った履歴を突き合わせるだけで、Googleへの
 * 往復は増えない。新しい睡眠（まだ送っていないもの）は数えない。それは毎朝の送信が拾うもので、
 * ここで知らせたいのは「送ったあとに直したので、ヘルスケアとずれている」ものだけ。
 */
export async function countSleepHealthOutdated(
  userId: string,
  input: {
    events: GoogleEvent[];
    title: string;
    /** 画面が読んだ範囲の始まり。これより前の履歴は、予定を読んでいないため見ない。 */
    since: Date;
    now: Date;
    timeZone: string;
  },
): Promise<number> {
  const { events, title, now, timeZone } = input;

  // 画面の日数（14日・30日）が `EDIT_LOOKBACK_DAYS` より広くても、数えるのは送信側（GET）が
  // 見る範囲まで。それより前に直した睡眠まで数えると、ショートカットを走らせても
  // 何も送られず、押しても件数が減らない帯が残る（issue #667 計画レビューG2）。
  const apiSince = sleepHealthEditSince(now);
  const editSince = input.since.getTime() > apiSince.getTime() ? input.since : apiSince;

  const sent = await listSleepHealthSent(userId, editSince);
  if (sent.length === 0) return 0;

  // `after` を `now` にして新しい睡眠を数えない（終わりが `now` より後のものは元から対象外）。
  const plan = planSleepHealthSync(events, sent, {
    title,
    after: now,
    editSince,
    now,
    timeZone,
  });

  return plan.stale.length;
}
