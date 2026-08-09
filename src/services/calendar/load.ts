import { db } from "@/lib/db";
import { listCalendars } from "@/services/google-calendar/calendars";
import { listEvents } from "@/services/google-calendar/events";
import { GoogleReauthRequiredError } from "@/services/google-calendar/tokens";
import { createNotionClient } from "@/services/notion/client";
import { listTasksInRange } from "@/services/notion/tasks";
import type {
  CalendarEventItem,
  CalendarLoadResult,
  TaskItem,
  WritableCalendar,
} from "@/types/calendar";

/**
 * カレンダー画面に表示する予定とタスクをまとめて取得する。
 * 片方の連携が失敗しても、もう片方は表示できるようにエラーを握って返す
 * （どちらも落ちていることに気付けるよう、errorsとして必ず伝える）。
 */
export async function loadCalendarData(
  userId: string,
  range: { timeMin: string; timeMax: string },
): Promise<CalendarLoadResult> {
  const [events, tasks] = await Promise.all([
    loadGoogleEvents(userId, range),
    loadNotionTasks(userId, range),
  ]);

  return {
    events: events.items,
    tasks: tasks.items,
    calendars: events.calendars,
    notionReady: tasks.ready,
    errors: [...events.errors, ...tasks.errors],
  };
}

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
      orderBy: { sortOrder: "asc" },
    });
    if (visibleSettings.length === 0) continue;

    try {
      // 名前と色はGoogleが一次情報源なので、予定と同じタイミングで取り直す。
      const entries = await listCalendars(account);
      const entryById = new Map(entries.map((entry) => [entry.id, entry]));

      const results = await Promise.all(
        visibleSettings.map(async (setting) => {
          const entry = entryById.get(setting.calendarId);
          // Google側で削除・共有解除されたカレンダーは設定だけ残る。表示対象から外す。
          if (!entry) return [];

          // 読み取り専用で共有されたカレンダーには予定を作れないため、保存先の候補から外す。
          if (entry.accessRole === "owner" || entry.accessRole === "writer") {
            calendars.push({
              calendarId: setting.calendarId,
              name: entry.summaryOverride?.trim() || entry.summary,
              color: entry.backgroundColor ?? null,
              isCreateDefault: setting.isCreateDefault,
            });
          }

          return listEvents(
            account,
            {
              calendarId: setting.calendarId,
              name: entry.summaryOverride?.trim() || entry.summary,
              color: entry.backgroundColor ?? null,
            },
            range,
          );
        }),
      );

      items.push(...results.flat());
    } catch (error) {
      errors.push({
        source: "google",
        reason:
          error instanceof GoogleReauthRequiredError
            ? `${account.email} の認可が失効しました。設定画面から再接続してください。`
            : `${account.email} の予定を取得できませんでした。`,
      });
    }
  }

  return { items, calendars, errors };
}

async function loadNotionTasks(
  userId: string,
  range: { timeMin: string; timeMax: string },
): Promise<{ items: TaskItem[]; ready: boolean; errors: CalendarLoadResult["errors"] }> {
  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection?.taskDataSourceId) return { items: [], ready: false, errors: [] };

  try {
    const tasks = await listTasksInRange(createNotionClient(connection), connection, {
      // Notionの日付フィルタは日付境界で比較するため、日付部分だけを渡す。
      from: range.timeMin.slice(0, 10),
      to: range.timeMax.slice(0, 10),
    });
    return { items: tasks, ready: true, errors: [] };
  } catch {
    return {
      items: [],
      ready: true,
      errors: [{ source: "notion", reason: "Notionのタスクを取得できませんでした。" }],
    };
  }
}
