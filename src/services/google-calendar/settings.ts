import { db } from "@/lib/db";

import { calendarDisplayName, listCalendars, type GoogleCalendarListEntry } from "./calendars";
import { GoogleReauthRequiredError } from "./tokens";

export type CalendarSummary = {
  settingId: string;
  googleAccountId: string;
  accountEmail: string;
  calendarId: string;
  name: string;
  backgroundColor: string | null;
  primary: boolean;
  accessRole: string;
  visible: boolean;
  isCreateDefault: boolean;
};

export type CalendarSettingsResult =
  | { status: "not_connected" }
  | { status: "reauth_required"; accountEmail: string }
  | { status: "ok"; accounts: { id: string; email: string }[]; calendars: CalendarSummary[] };

/**
 * 表示対象カレンダーの設定を、Google側の一覧と突き合わせて返す。
 * カレンダー名・色はGoogleが一次情報源なのでDBには保存せず、都度取得して合成する。
 */
export async function loadCalendarSettings(userId: string): Promise<CalendarSettingsResult> {
  const accounts = await db.googleAccount.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });

  if (accounts.length === 0) {
    return { status: "not_connected" };
  }

  const calendars: CalendarSummary[] = [];

  for (const account of accounts) {
    let entries: GoogleCalendarListEntry[];
    try {
      entries = await listCalendars(account);
    } catch (error) {
      if (error instanceof GoogleReauthRequiredError) {
        return { status: "reauth_required", accountEmail: account.email };
      }
      throw error;
    }

    const settings = await ensureCalendarSettings(userId, account.id, entries);
    const settingByCalendarId = new Map(settings.map((s) => [s.calendarId, s]));

    for (const entry of entries) {
      const setting = settingByCalendarId.get(entry.id);
      if (!setting) continue;

      calendars.push({
        settingId: setting.id,
        googleAccountId: account.id,
        accountEmail: account.email,
        calendarId: entry.id,
        name: calendarDisplayName(entry),
        backgroundColor: entry.backgroundColor ?? null,
        primary: Boolean(entry.primary),
        accessRole: entry.accessRole,
        visible: setting.visible,
        isCreateDefault: setting.isCreateDefault,
      });
    }
  }

  return {
    status: "ok",
    accounts: accounts.map((a) => ({ id: a.id, email: a.email })),
    calendars,
  };
}

/**
 * 初回接続時、およびGoogle側でカレンダーが増えたときに設定行を補う。
 * 既定の表示ON/OFFはGoogle Calendar側の選択状態に合わせ、初回から見慣れた並びになるようにする。
 */
async function ensureCalendarSettings(
  userId: string,
  googleAccountId: string,
  entries: GoogleCalendarListEntry[],
) {
  const existing = await db.calendarSetting.findMany({ where: { googleAccountId } });
  const existingIds = new Set(existing.map((s) => s.calendarId));
  const missing = entries.filter((entry) => !existingIds.has(entry.id));

  if (missing.length > 0) {
    await db.calendarSetting.createMany({
      data: missing.map((entry, index) => ({
        userId,
        googleAccountId,
        calendarId: entry.id,
        visible: entry.selected ?? Boolean(entry.primary),
        isCreateDefault: Boolean(entry.primary) && existing.length === 0,
        sortOrder: existing.length + index,
      })),
    });
  }

  return db.calendarSetting.findMany({
    where: { googleAccountId },
    orderBy: { sortOrder: "asc" },
  });
}
