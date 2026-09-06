import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { localInputToIso } from "@/components/calendar/datetime-fields";
import { addDays, parseDateKey, toDateKey } from "@/lib/calendar-range";
import { db } from "@/lib/db";
import { loadGoogleEvents } from "@/services/calendar/load";
import { listTravelsInRange, toTravelItem } from "@/services/travel/plans";
import { readWidgetCache, writeWidgetCache } from "@/services/widget/cache";
import type { WidgetScheduleItem, WidgetSchedulePayload } from "@/types/widget";

/**
 * iPhoneウィジェットの「今日の予定」（docs/spec.md §28）。
 *
 * 読むのはGoogleの予定と、DaySpanのDBにある移動だけ。`loadCalendarData()` を通さないのは、
 * あれが日付リマインド・ゴミの日・勤務記録・タスクまで一度に読むためで、5分ごとの更新の
 * たびにNotionへの往復が何本も積み上がる（docs/spec.md §20）。移動を混ぜるのは、出発時刻が
 * まさにホーム画面で読みたい値であり、DaySpanのDBの読み取りだけで済むため。
 */
export async function buildWidgetSchedule(userId: string): Promise<WidgetSchedulePayload> {
  const now = new Date();

  const uiSetting = await db.uiSetting.findUnique({
    where: { userId },
    select: { timeZone: true },
  });
  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";
  const utils = createCalendarDateUtils(timeZone);
  const dateKey = utils.todayKey();

  const source = await loadSource(userId, timeZone, dateKey, now);

  return {
    timeZone,
    now: now.toISOString(),
    date: dateKey,
    // 過ぎたかどうかは持ち回さずここで決める。持ち回すと、時刻が進んでも
    // 「これから」のままの予定が最大3分残る。
    items: order(source.items, now),
    unavailable: source.unavailable,
  };
}

/** 持ち回す中身。過ぎたかどうか（`past`）は毎回付け直すため、ここでは持たない。 */
type ScheduleSource = {
  items: Omit<WidgetScheduleItem, "past">[];
  unavailable: WidgetSchedulePayload["unavailable"];
};

async function loadSource(
  userId: string,
  timeZone: string,
  dateKey: string,
  now: Date,
): Promise<ScheduleSource> {
  const cached = readWidgetCache<ScheduleSource>(userId, "schedule", now);
  if (cached) return cached;

  // Google未接続は失敗ではなく空で返るため（services/calendar/load.ts）、繋いでいないことを
  // 先に見分ける。区別しないと、繋いでいない人のウィジェットに「今日の予定はありません」と出る。
  const googleAccounts = await db.googleAccount.count({ where: { userId } });
  if (googleAccounts === 0) return { items: [], unavailable: "google_not_connected" };

  const timeMin = localInputToIso(`${dateKey}T00:00`, timeZone);
  const timeMax = localInputToIso(`${toDateKey(addDays(parseDateKey(dateKey), 1))}T00:00`, timeZone);
  const range = { timeMin, timeMax };

  // 移動はDaySpanのDBにあり、外部APIの往復は増えない。Googleと並行に読む。
  const [events, travelPlans] = await Promise.all([
    loadGoogleEvents(userId, range),
    listTravelsInRange(userId, range),
  ]);

  // カレンダーを1つも取れていないのに errors だけが積まれている状態は「取得できなかった」。
  // 予定が0件だったのと区別しないと、Googleが落ちている日に「今日の予定はありません」と出る。
  if (events.items.length === 0 && events.errors.length > 0) {
    return { items: [], unavailable: "google_unavailable" };
  }

  const utils = createCalendarDateUtils(timeZone);

  // Googleへ書き出した移動は予定としても返ってくる。同じものを2つ並べないよう落とす
  // （loadCalendarData() がやっているのと同じ突き合わせ・docs/spec.md §29）。
  const exportedEventIds = new Set(
    travelPlans.map((plan) => plan.googleEventId).filter((id): id is string => Boolean(id)),
  );

  const items: Omit<WidgetScheduleItem, "past">[] = [];

  for (const event of events.items) {
    if (exportedEventIds.has(event.id)) continue;
    if (!utils.eventCoversDay(event, dateKey)) continue;

    items.push({
      kind: "event",
      title: event.title,
      allDay: event.allDay,
      start: event.allDay ? null : event.start,
      end: event.allDay ? null : event.end,
      detail: event.location,
      mode: null,
      outcome: event.outcome?.kind ?? null,
    });
  }

  for (const plan of travelPlans) {
    const travel = toTravelItem(plan);
    if (utils.itemDateKey(travel.start) > dateKey || utils.itemDateKey(travel.end) < dateKey) {
      continue;
    }

    items.push({
      kind: "travel",
      // 枠に入るのは1行ぶん。「自宅 → 大阪駅」だと出発地で幅を使い切るため、行き先だけを出す。
      title: travel.destination,
      allDay: false,
      start: travel.start,
      end: travel.end,
      detail: `${minutesBetween(travel.start, travel.end)}分`,
      mode: travel.mode,
      outcome: null,
    });
  }

  const source: ScheduleSource = { items, unavailable: null };
  writeWidgetCache(userId, "schedule", source, now);

  return source;
}

/**
 * これからのものが先、過ぎたものが後。どちらも終日を先頭に、あとは時刻順。
 *
 * 過ぎたかどうかはサーバーの `now` で決める。端末の時計がずれていると、まだ始まっていない
 * 予定が「済み」になる（記録の開始・終了の時刻をサーバーの時計で決めているのと同じ理由）。
 */
function order(items: ScheduleSource["items"], now: Date): WidgetScheduleItem[] {
  const withPast = items.map((item) => ({
    ...item,
    // 終日は一日中これからのものとして扱う。日付が変わるまでその日を指し続けるため。
    past: item.end !== null && new Date(item.end).getTime() <= now.getTime(),
  }));

  return withPast.sort((a, b) => {
    if (a.past !== b.past) return a.past ? 1 : -1;
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    if (a.start && b.start && a.start !== b.start) return a.start < b.start ? -1 : 1;
    return a.title.localeCompare(b.title, "ja");
  });
}

function minutesBetween(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
}
