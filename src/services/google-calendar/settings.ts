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
  writeEnabled: boolean;
  /** Google側で書き込みを許されているか。読み取り専用の共有では「使用」を選べない。 */
  canWrite: boolean;
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
        writeEnabled: setting.writeEnabled,
        canWrite: canWriteCalendar(entry.accessRole),
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

/** 読み取り専用で共有されたカレンダーには、そもそも予定を作れない。 */
export function canWriteCalendar(accessRole: string): boolean {
  return accessRole === "owner" || accessRole === "writer";
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
      data: missing.map((entry, index) => {
        const visible = entry.selected ?? Boolean(entry.primary);
        // 後から増えたカレンダーは、書き込める権限があるものだけ使用オンで始める。
        // 読み取り専用の共有はどのみち書き込めないため、選べる状態にしない。
        const writeEnabled = visible && canWriteCalendar(entry.accessRole);
        return {
          userId,
          googleAccountId,
          calendarId: entry.id,
          visible,
          writeEnabled,
          // 使用オフのカレンダーを既定の保存先にはしない。保存先の選択肢に出ないカレンダーが
          // 初期値になると、入力画面を開いた時点で保存できない状態になる。
          isCreateDefault: writeEnabled && Boolean(entry.primary) && existing.length === 0,
          sortOrder: nextOrder + index,
        };
      }),
    });
  }

  await disableWritesForReadOnlyCalendars(existing, entries);

  return db.calendarSetting.findMany({
    where: { googleAccountId },
    orderBy: SETTING_ORDER,
  });
}

/**
 * Google側で書き込めないカレンダーの「使用」を落とす。
 *
 * writeEnabled を足したマイグレーションは、これまでの表示設定をそのまま引き継いでいる。
 * DBにはアクセス権限が無いため、読み取り専用で共有されたカレンダーも使用オンのまま残る。
 * 設定画面ではオフにできず（そもそも選べない）、書き込みの判定も通ってしまうので、
 * 一覧を取れたこの時点で実態に合わせる。共有の権限が上がった場合は利用者が選び直す。
 */
async function disableWritesForReadOnlyCalendars(
  existing: { id: string; calendarId: string; writeEnabled: boolean }[],
  entries: GoogleCalendarListEntry[],
) {
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));

  const stale = existing.filter((setting) => {
    const entry = entryById.get(setting.calendarId);
    return setting.writeEnabled && entry !== undefined && !canWriteCalendar(entry.accessRole);
  });

  if (stale.length === 0) return;

  await db.calendarSetting.updateMany({
    where: { id: { in: stale.map((setting) => setting.id) } },
    data: { writeEnabled: false, isCreateDefault: false },
  });
}
