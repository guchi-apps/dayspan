import type { GoogleAccount, NotionConnection, Prisma } from "@prisma/client";

import { db } from "@/lib/db";

/** 書き込み先を引けなかった理由。使用オフと存在しないカレンダーを画面で区別するために分ける。 */
export type CalendarWriteTarget =
  | { ok: true; account: GoogleAccount }
  | { ok: false; reason: "not_found" | "write_disabled" };

/**
 * 書き込み先の特定。カレンダーIDから、それを扱えるGoogleアカウントを引く。
 * 他ユーザーのカレンダーを指定されても解決できないよう、必ずuserIdで絞る。
 *
 * 「使用」がオフのカレンダーはここで弾く。判定をUIではなくこの1か所に置くことで、
 * 画面・API・将来のMCPのどこから来ても同じ結果になる（docs/spec.md §7）。
 */
export async function resolveGoogleAccountForCalendar(
  userId: string,
  calendarId: string,
): Promise<CalendarWriteTarget> {
  const setting = await db.calendarSetting.findFirst({
    where: { userId, calendarId },
    include: { googleAccount: true },
  });

  if (!setting) return { ok: false, reason: "not_found" };
  if (!setting.writeEnabled) return { ok: false, reason: "write_disabled" };

  return { ok: true, account: setting.googleAccount };
}

const CREATE_DEFAULT_ORDER: Prisma.CalendarSettingOrderByWithRelationInput[] = [
  { isCreateDefault: "desc" },
  { sortOrder: "asc" },
  { createdAt: "asc" },
];

/**
 * `calendarId` を指定されなかったときに使う既定の保存先を解決する（予定新規作成の既定と同じ、
 * `CalendarSetting.isCreateDefault`）。書き込みが無効なカレンダーは既定にならないため、
 * `writeEnabled: true` に絞ったうえで一番優先度の高いものを返す。
 *
 * 書き込めるカレンダーが1つも無ければ null（Google未接続、または全カレンダーの使用オフ）。
 */
export async function resolveDefaultCalendarId(userId: string): Promise<string | null> {
  const setting = await db.calendarSetting.findFirst({
    where: { userId, writeEnabled: true },
    orderBy: CREATE_DEFAULT_ORDER,
    select: { calendarId: true },
  });

  return setting?.calendarId ?? null;
}

export async function getNotionConnection(userId: string): Promise<NotionConnection | null> {
  const connection = await db.notionConnection.findUnique({ where: { userId } });
  return connection?.taskDataSourceId ? connection : null;
}

/** 日付リマインドの書き込み先。タスクDBとは別に選ぶため、設定済みかどうかも別に見る。 */
export async function getNotionReminderConnection(userId: string): Promise<NotionConnection | null> {
  const connection = await db.notionConnection.findUnique({ where: { userId } });
  return connection?.reminderDataSourceId ? connection : null;
}

/** 勤務記録の書き込み先（docs/spec.md §34）。他のDBと同じく、設定済みかどうかを別に見る。 */
export async function getNotionWorkConnection(userId: string): Promise<NotionConnection | null> {
  const connection = await db.notionConnection.findUnique({ where: { userId } });
  return connection?.workDataSourceId ? connection : null;
}

/** 場所の書き込み先。設定していないユーザーもいるため、タスク・リマインドとは別に見る。 */
export async function getNotionPlaceConnection(userId: string): Promise<NotionConnection | null> {
  const connection = await db.notionConnection.findUnique({ where: { userId } });
  return connection?.placeDataSourceId ? connection : null;
}

/** 買い物リストの書き込み先（docs/spec.md §36）。他のDBと同じく、設定済みかどうかを別に見る。 */
export async function getNotionShoppingConnection(
  userId: string,
): Promise<NotionConnection | null> {
  const connection = await db.notionConnection.findUnique({ where: { userId } });
  return connection?.shoppingDataSourceId ? connection : null;
}
