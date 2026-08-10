import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import { calendarDisplayName, listCalendars, type GoogleCalendarListEntry } from "./calendars";
import { GoogleReauthRequiredError } from "./tokens";

/**
 * 表示順。sortOrder が同じ行（並べ替えを一度もしていない古い設定）でも
 * 画面ごとに並びが入れ替わらないよう、作成順を第二の基準にする。
 */
export const SETTING_ORDER: Prisma.CalendarSettingOrderByWithRelationInput[] = [
  { sortOrder: "asc" },
  { createdAt: "asc" },
];

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
    const entryByCalendarId = new Map(entries.map((entry) => [entry.id, entry]));

    // 並べ替えた順に返す。Google側の一覧の順ではなく設定の sortOrder が表示順なので、
    // 設定の側から回す。Google側で削除・共有解除されたカレンダーは設定だけが残るため、
    // 一覧に無いものは飛ばす。
    for (const setting of settings) {
      const entry = entryByCalendarId.get(setting.calendarId);
      if (!entry) continue;

      calendars.push({
        settingId: setting.id,
        googleAccountId: account.id,
        accountEmail: account.email,
        calendarId: setting.calendarId,
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
    // 後から増えたカレンダーは末尾に足す。並べ替え済みの間に割り込むと、
    // Google側でカレンダーが1つ増えただけで手で決めた並びが崩れるため。
    const nextOrder = existing.reduce((max, s) => Math.max(max, s.sortOrder), -1) + 1;

    await db.calendarSetting.createMany({
      data: missing.map((entry, index) => ({
        userId,
        googleAccountId,
        calendarId: entry.id,
        visible: entry.selected ?? Boolean(entry.primary),
        isCreateDefault: Boolean(entry.primary) && existing.length === 0,
        sortOrder: nextOrder + index,
      })),
    });
  }

  return db.calendarSetting.findMany({
    where: { googleAccountId },
    orderBy: SETTING_ORDER,
  });
}
