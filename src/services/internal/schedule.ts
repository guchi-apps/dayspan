import { dateKeyDiffDays } from "@/lib/calendar-range";
import { db } from "@/lib/db";
import type { CalendarDateUtils } from "@/components/calendar/item-layout";
import { getNotionConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { listTasksInRange } from "@/services/notion/tasks";
import type {
  CalendarEventItem,
  CalendarLoadResult,
  ReminderItem,
  TaskItem,
  TravelItem,
} from "@/types/calendar";
import type {
  InternalEvent,
  InternalOverdueTask,
  InternalReminder,
  InternalScheduleDay,
  InternalTask,
  InternalTravel,
} from "@/types/internal-api";

// サーバー間参照用API（docs/internal-api.md）が返す形への詰め替え。
//
// ルートハンドラに置かない理由は他のサービス層と同じで、外部から呼ばれる形（HTTP）と
// 中身の組み立てを分けておくため。日ごとの振り分けと並び順はカレンダー画面と同じ関数
// （createCalendarDateUtils）を通す。ここで書き直すと、同じ日を画面で見たときと違う結果が返る。

/**
 * 連携そのものが設定されているか。
 *
 * 未接続のときGoogle・Notionの取得は「失敗」ではなく空で返るため、そのままだと呼び出し元には
 * 「今日は何も無い」と区別が付かない（services/calendar/load.ts）。朝のブリーフィングで
 * 「予定なし」と誤って伝わるのを避けるため、状態そのものを添える。
 */
export type InternalSources = {
  googleConnected: boolean;
  notionReady: boolean;
  reminderReady: boolean;
};

export async function loadSources(
  userId: string,
  data: Pick<CalendarLoadResult, "notionReady" | "reminderReady">,
): Promise<InternalSources> {
  // 予定を取れるかどうかは「表示オンのカレンダーがあるか」ではなくアカウントの有無で見る。
  // 表示を全部オフにしている状態と、そもそも繋いでいない状態は別の話。
  const googleAccounts = await db.googleAccount.count({ where: { userId } });

  return {
    googleConnected: googleAccounts > 0,
    notionReady: data.notionReady,
    reminderReady: data.reminderReady,
  };
}

/**
 * 期限切れタスクだけを、カレンダーの取得とは別にNotionへ取りにいく。
 *
 * カレンダーの取得範囲そのものを過去へ広げると、同じ範囲がGoogle・移動へも渡り、期限切れ
 * タスクのためだけに表示中のカレンダー全部の予定を毎回その日数ぶん取ることになる
 * （docs/spec.md §20「外部APIへ過剰なアクセスを発生させない」）。往復1回を惜しむより、
 * Notionへの1回を足して取得量を要求された日数に留めるほうが軽い。
 *
 * 失敗しても投げない。予定は取れているのに全体が落ちるのを避け、理由は errors に載せる。
 */
export async function loadOverdueSource(
  userId: string,
  range: { lookbackFrom: string; lastDay: string },
): Promise<{ tasks: TaskItem[]; errors: CalendarLoadResult["errors"] }> {
  const connection = await getNotionConnection(userId);
  if (!connection) return { tasks: [], errors: [] };

  try {
    const tasks = await listTasksInRange(createNotionClient(connection), connection, {
      from: range.lookbackFrom,
      to: range.lastDay,
    });
    return { tasks, errors: [] };
  } catch {
    return {
      tasks: [],
      errors: [{ source: "notion", reason: "期限を過ぎたタスクを取得できませんでした。" }],
    };
  }
}

export type LoadedItems = {
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  travels: TravelItem[];
};

export function buildDay(
  utils: CalendarDateUtils,
  data: LoadedItems,
  dateKey: string,
): InternalScheduleDay {
  const events = data.events
    .filter((event) => utils.eventCoversDay(event, dateKey))
    .map((event) => toInternalEvent(utils, event, dateKey))
    .sort(byVisibleStart);

  const tasks = utils
    .taskOccurrencesOnDay(data.tasks, dateKey)
    .sort((a, b) =>
      utils.compareItems(
        { item: a.task, taskField: a.field },
        { item: b.task, taskField: b.field },
      ),
    )
    .map(
      (occurrence): InternalTask => ({
        id: occurrence.task.id,
        title: occurrence.task.title,
        field: occurrence.field,
        date: occurrence.date,
        hasTime: occurrence.hasTime,
        time: occurrence.hasTime ? utils.formatTime(occurrence.date) : null,
        priority: occurrence.task.priority,
        tags: occurrence.task.tags,
        memo: occurrence.task.memo,
        url: occurrence.task.url,
      }),
    );

  const reminders = data.reminders
    .filter((reminder) => utils.itemDateKey(reminder.date) === dateKey)
    .sort((a, b) => utils.compareItems({ item: a }, { item: b }))
    .map(
      (reminder): InternalReminder => ({
        id: reminder.id,
        title: reminder.title,
        date: reminder.date,
        hasTime: reminder.hasTime,
        time: reminder.hasTime ? utils.formatTime(reminder.date) : null,
        category: reminder.category,
        annual: reminder.annual,
        source: reminder.source,
        memo: reminder.memo,
        url: reminder.url,
      }),
    );

  const travels = data.travels
    .filter(
      (travel) =>
        utils.itemDateKey(travel.start) <= dateKey && dateKey <= utils.itemDateKey(travel.end),
    )
    .map((travel): InternalTravel => {
      const { startTime, endTime } = clippedTimes(utils, travel.start, travel.end, dateKey);
      return {
        id: travel.id,
        title: travel.title,
        origin: travel.origin,
        destination: travel.destination,
        mode: travel.mode,
        start: travel.start,
        end: travel.end,
        startTime,
        endTime,
        estimated: travel.estimated,
        estimateSource: travel.estimateSource,
        returnLeg: travel.returnLeg,
        note: travel.note,
      };
    })
    .sort(byVisibleStart);

  return { date: dateKey, events, tasks, reminders, travels };
}

/**
 * その日に見えている開始時刻の順。終日は先頭、同時刻はタイトル順。
 *
 * 画面の並び（compareItems）は日をまたぐ予定を元の開始時刻（前日の23:00 など）で扱う。
 * 画面はそれでも位置で時間帯を示せるが、APIは配列の順序でしか時系列を伝えられず、
 * 前の晩から続いている予定が「その日の最後」に並ぶ。startTime を 00:00 へ切り詰めて
 * 返しているのに順序だけ元の時刻に従うと、返した値の中で食い違う。
 */
function byVisibleStart(
  a: { startTime: string | null; title: string },
  b: { startTime: string | null; title: string },
): number {
  // 終日は時刻を持たない。時刻のあるものより前に置く。
  const diff = (a.startTime ?? "").localeCompare(b.startTime ?? "");
  if (diff !== 0) return diff;
  return a.title.localeCompare(b.title, "ja");
}

function toInternalEvent(
  utils: CalendarDateUtils,
  event: CalendarEventItem,
  dateKey: string,
): InternalEvent {
  // 終日予定の start / end は YYYY-MM-DD。時刻として解釈するとUTC0時とみなされ、
  // 設定タイムゾーンでは 09:00 のような別の時刻に化けるため、時刻は持たせない。
  const { startTime, endTime } = event.allDay
    ? { startTime: null, endTime: null }
    : clippedTimes(utils, event.start, event.end, dateKey);

  return {
    id: event.id,
    title: event.title,
    allDay: event.allDay,
    start: event.start,
    end: event.end,
    startTime,
    endTime,
    location: event.location,
    description: event.description,
    calendarName: event.calendarName,
    recurring: event.recurring,
    url: event.url,
  };
}

/**
 * その日に占める時間帯。日をまたぐ項目は、その日の範囲へ切り詰める。
 *
 * 前日から続いているものは 00:00 から、翌日へ続くものは 24:00 まで。切り詰めずに元の時刻を
 * 返すと、呼び出し元では「今日の23時に始まって明日の8時に終わる」のか「今日の8時に終わる」のかを
 * 日付まで見比べないと決められない。
 */
function clippedTimes(
  utils: CalendarDateUtils,
  start: string,
  end: string,
  dateKey: string,
): { startTime: string; endTime: string } {
  return {
    startTime: utils.itemDateKey(start) === dateKey ? utils.formatTime(start) : "00:00",
    endTime: utils.itemDateKey(end) === dateKey ? utils.formatTime(end) : "24:00",
  };
}

/**
 * 期限を過ぎた未完了タスク。範囲の初日より前に期限があるもの。
 *
 * 取得元の listTasksInRange() が完了済みを除いているため、ここに残るのは必ず未完了。
 * 範囲内の日にも現れるタスク（期限は過ぎているが予定日が今日、など）は除く。同じタスクを
 * 「今日やること」と「積み残し」の両方へ出しても、読む側で件数が水増しされるだけのため。
 */
export function buildOverdueTasks(
  utils: CalendarDateUtils,
  tasks: TaskItem[],
  range: { from: string; lookbackFrom: string },
  days: InternalScheduleDay[],
): InternalOverdueTask[] {
  const shownTaskIds = new Set(days.flatMap((day) => day.tasks.map((task) => task.id)));

  return tasks
    .filter((task) => {
      if (!task.due || shownTaskIds.has(task.id)) return false;
      // 予定日しか範囲より前に無いものは「期限切れ」ではない。期限の枠だけを見る。
      const dueKey = utils.itemDateKey(task.due);
      // 遡る上限は呼び出し側が決める。取得の範囲は期限だけでなく予定日でも引っかかるため、
      // 上限を確かめないと、はるか昔に期限が切れたまま予定日だけ最近のタスクが混ざる。
      return range.lookbackFrom <= dueKey && dueKey < range.from;
    })
    .sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : 0))
    .map((task): InternalOverdueTask => {
      const due = task.due!;
      return {
        id: task.id,
        title: task.title,
        due,
        hasTime: task.hasTime,
        time: task.hasTime ? utils.formatTime(due) : null,
        daysOverdue: dateKeyDiffDays(utils.itemDateKey(due), range.from),
        priority: task.priority,
        tags: task.tags,
        url: task.url,
      };
    });
}
