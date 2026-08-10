import type { GoogleAccount, NotionConnection } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * 書き込み先の特定。カレンダーIDから、それを扱えるGoogleアカウントを引く。
 * 他ユーザーのカレンダーを指定されても解決できないよう、必ずuserIdで絞る。
 */
export async function resolveGoogleAccountForCalendar(
  userId: string,
  calendarId: string,
): Promise<GoogleAccount | null> {
  const setting = await db.calendarSetting.findFirst({
    where: { userId, calendarId },
    include: { googleAccount: true },
  });

  return setting?.googleAccount ?? null;
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
