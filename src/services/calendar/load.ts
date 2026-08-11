import { db } from "@/lib/db";
import { listCalendars } from "@/services/google-calendar/calendars";
import { listEvents, toCalendarItems, type GoogleEvent } from "@/services/google-calendar/events";
import { SETTING_ORDER } from "@/services/google-calendar/settings";
import { GoogleReauthRequiredError } from "@/services/google-calendar/tokens";
import { createNotionClient } from "@/services/notion/client";
import { listTasksInRange } from "@/services/notion/tasks";
import { listRemindersInRange } from "@/services/notion/reminders";
import type {
  CalendarEventItem,
  CalendarLoadResult,
  ReminderItem,
  TaskItem,
  WritableCalendar,
} from "@/types/calendar";

/**
 * 書き込み可能なカレンダーのリストを読み込む。
 * タスク・日付リマインドページから予定を作成する際の保存先選択に使う。
 */
export async function loadWritableCalendars(userId: string): Promise<WritableCalendar[]> {
  const accounts = await db.googleAccount.findMany({ where: { userId } });
  if (accounts.length === 0) return [];

  const calendars: WritableCalendar[] = [];

  for (const account of accounts) {
    const visibleSettings = await db.calendarSetting.findMany({
      where: { googleAccountId: account.id, visible: true },
      orderBy: SETTING_ORDER,
    });
    if (visibleSettings.length === 0) continue;

    try {
      const entries = await listCalendars(account);
      const entryById = new Map(entries.map((entry) => [entry.id, entry]));

      visibleSettings.forEach((setting) => {
        const entry = entryById.get(setting.calendarId);
        if (!entry) return;

        // 読み取り専用で共有されたカレンダーには予定を作れないため、候補から外す。
        if (entry.accessRole === "owner" || entry.accessRole === "writer") {
          calendars.push({
            calendarId: setting.calendarId,
            name: entry.summaryOverride?.trim() || entry.summary,
            color: entry.backgroundColor ?? null,
            isCreateDefault: setting.isCreateDefault,
          });
        }
      });
    } catch {
      // 1つのアカウントで失敗してもカレンダー一覧の読み込みは続ける
      continue;
    }
  }

  return calendars;
}

/**
 * カレンダー画面に表示する予定とタスクをまとめて取得する。
 * 片方の連携が失敗しても、もう片方は表示できるようにエラーを握って返す
 * （どちらも落ちていることに気付けるよう、errorsとして必ず伝える）。
 */
export async function loadCalendarData(
  userId: string,
  range: { timeMin: string; timeMax: string },
): Promise<CalendarLoadResult> {
  const [events, notion] = await Promise.all([
    loadGoogleEvents(userId, range),
    loadNotionItems(userId, range),
  ]);

  return {
    events: events.items,
    tasks: notion.tasks,
    reminders: notion.reminders,
    calendars: events.calendars,
    notionReady: notion.ready,
    reminderReady: notion.reminderReady,
    errors: [...events.errors, ...notion.errors],
  };
}

/** カレンダー1つ分の取得結果。1つの失敗で他のカレンダーまで巻き添えにしないために分けて持つ。 */
type EventsFetchResult =
  | { ok: true; events: GoogleEvent[] }
  | { ok: false };

async function loadGoogleEvents(
  userId: string,
  range: { timeMin: string; timeMax: string },
): Promise<{
  items: CalendarEventItem[];
  calendars: WritableCalendar[];
  errors: CalendarLoadResult["errors"];
}> {
  const accounts = await db.googleAccount.findMany({ where: { userId } });
  if (accounts.length === 0) return { items: [], calendars: [], errors: [] };

  const items: CalendarEventItem[] = [];
  const calendars: WritableCalendar[] = [];
  const errors: CalendarLoadResult["errors"] = [];

  for (const account of accounts) {
    const visibleSettings = await db.calendarSetting.findMany({
      where: { googleAccountId: account.id, visible: true },
      orderBy: SETTING_ORDER,
    });
    if (visibleSettings.length === 0) continue;

    // 予定の取得に要るのはカレンダーIDだけで、それはDBにある。名前と色のために
    // calendarList の応答を待ってから予定を取りにいくと、Googleへの往復が直列に2回積み上がる。
    // 互いに依存しないので並行に投げ、揃ってから突き合わせる。
    //
    // 並行にした代償として、Google側で消えたカレンダーにも予定を取りにいってしまう。
    // その404でアカウント全体を落とさないよう、カレンダー単位の失敗はここで受け止める。
    const fetchEvents = (calendarId: string): Promise<EventsFetchResult> =>
      listEvents(account, calendarId, range).then(
        (events) => ({ ok: true, events }),
        () => ({ ok: false }),
      );

    let entries;
    let eventResults: EventsFetchResult[];

    try {
      [entries, eventResults] = await Promise.all([
        listCalendars(account),
        Promise.all(visibleSettings.map((setting) => fetchEvents(setting.calendarId))),
      ]);
    } catch (error) {
      errors.push({
        source: "google",
        reason:
          error instanceof GoogleReauthRequiredError
            ? `${account.email} の認可が失効しました。設定画面から再接続してください。`
            : `${account.email} の予定を取得できませんでした。`,
      });
      continue;
    }

    const entryById = new Map(entries.map((entry) => [entry.id, entry]));

    visibleSettings.forEach((setting, index) => {
      const entry = entryById.get(setting.calendarId);
      // Google側で削除・共有解除されたカレンダーは設定だけ残る。表示対象から外す
      // （このカレンダーの取得が失敗していても、消えているのだから報告しない）。
      if (!entry) return;

      const display = {
        calendarId: setting.calendarId,
        name: entry.summaryOverride?.trim() || entry.summary,
        color: entry.backgroundColor ?? null,
      };

      // 読み取り専用で共有されたカレンダーには予定を作れないため、保存先の候補から外す。
      if (entry.accessRole === "owner" || entry.accessRole === "writer") {
        calendars.push({ ...display, isCreateDefault: setting.isCreateDefault });
      }

      const result = eventResults[index];
      if (!result.ok) {
        errors.push({
          source: "google",
          reason: `${account.email} の「${display.name}」の予定を取得できませんでした。`,
        });
        return;
      }

      items.push(...toCalendarItems(result.events, display));
    });
  }

  return { items, calendars, errors };
}

async function loadNotionItems(
  userId: string,
  range: { timeMin: string; timeMax: string },
): Promise<{
  tasks: TaskItem[];
  reminders: ReminderItem[];
  ready: boolean;
  reminderReady: boolean;
  errors: CalendarLoadResult["errors"];
}> {
  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection?.taskDataSourceId && !connection?.reminderDataSourceId) {
    return { tasks: [], reminders: [], ready: false, reminderReady: false, errors: [] };
  }

  try {
    const notion = createNotionClient(connection);
    const dateRange = {
      // Notionの日付フィルタは日付境界で比較するため、日付部分だけを渡す。
      from: range.timeMin.slice(0, 10),
      to: range.timeMax.slice(0, 10),
    };
    const [tasks, reminders] = await Promise.all([
      connection.taskDataSourceId ? listTasksInRange(notion, connection, dateRange) : [],
      connection.reminderDataSourceId ? listRemindersInRange(notion, connection, dateRange) : [],
    ]);
    return {
      tasks,
      reminders,
      ready: Boolean(connection.taskDataSourceId),
      reminderReady: Boolean(connection.reminderDataSourceId),
      errors: [],
    };
  } catch {
    return {
      tasks: [],
      reminders: [],
      ready: Boolean(connection.taskDataSourceId),
      reminderReady: Boolean(connection.reminderDataSourceId),
      errors: [{ source: "notion", reason: "Notionのタスクまたは日付リマインドを取得できませんでした。" }],
    };
  }
}
