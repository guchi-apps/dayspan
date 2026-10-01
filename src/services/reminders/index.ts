import type { NotionConnection } from "@prisma/client";

import { db } from "@/lib/db";
import type { ReminderItem } from "@/types/calendar";

import { createNotionClient } from "@/services/notion/client";
import * as notionReminders from "@/services/notion/reminders";
import { loadTagCatalog } from "@/services/notion/tag-options";

import {
  createReminderInDb,
  deleteReminderInDb,
  listAllRemindersFromDb,
  listRemindersInRangeFromDb,
  updateReminderInDb,
} from "./db-store";

export { ReminderNotEditableError } from "@/services/notion/reminders";
export type { ReminderWriteInput } from "@/services/notion/reminders";

// 日付リマインドの読み書きの入口（issue #928）。`NotionConnection.remindersInDb` が true なら
// YoteiFlowのDB、false なら従来どおりNotionを使う（services/tasks と同じ切替）。

/** 日付リマインドを扱える状態か（DBに置く、またはNotionのDBを選んでいる）。 */
export function reminderSourceReady(connection: NotionConnection | null | undefined): boolean {
  return Boolean(connection && (connection.remindersInDb || connection.reminderDataSourceId));
}

export async function listRemindersInRange(
  connection: NotionConnection,
  range: { from: string; to: string },
): Promise<ReminderItem[]> {
  if (connection.remindersInDb) return listRemindersInRangeFromDb(connection.userId, range);
  return notionReminders.listRemindersInRange(createNotionClient(connection), connection, range);
}

export async function listAllReminders(connection: NotionConnection): Promise<ReminderItem[]> {
  if (connection.remindersInDb) return listAllRemindersFromDb(connection.userId);
  return notionReminders.listAllReminders(createNotionClient(connection), connection);
}

export async function createReminder(
  connection: NotionConnection,
  input: notionReminders.ReminderWriteInput,
): Promise<{ id: string }> {
  if (connection.remindersInDb) return createReminderInDb(connection.userId, input);
  return notionReminders.createReminder(createNotionClient(connection), connection, input);
}

export async function updateReminder(
  connection: NotionConnection,
  reminderId: string,
  input: notionReminders.ReminderWriteInput,
): Promise<void> {
  if (connection.remindersInDb) return updateReminderInDb(connection.userId, reminderId, input);
  return notionReminders.updateReminder(createNotionClient(connection), connection, reminderId, input);
}

export async function deleteReminder(connection: NotionConnection, reminderId: string): Promise<void> {
  if (connection.remindersInDb) return deleteReminderInDb(connection.userId, reminderId);
  return notionReminders.deleteReminder(createNotionClient(connection), connection, reminderId);
}

/**
 * Notionの日付リマインドをYoteiFlowのDBへ取り込み、以後はDBを正にする。
 * 何度実行しても同じ結果になる（idはNotionのページID）。Notionが応答しなければ失敗を返し、
 * `remindersInDb` は変えない。
 */
export async function importRemindersFromNotion(
  connection: NotionConnection,
): Promise<{ imported: number }> {
  if (!connection.reminderDataSourceId) throw new Error("Reminder data source is not configured");

  const reminders = await notionReminders.listAllReminders(createNotionClient(connection), connection);
  const catalog = await loadTagCatalog(connection);
  const userId = connection.userId;

  await db.$transaction(
    async (tx) => {
      for (const item of reminders) {
        const data = {
          title: item.title,
          date: item.date,
          category: item.category,
          memo: item.memo,
          annual: Boolean(item.annual),
        };
        await tx.reminder.upsert({
          where: { id: item.id },
          create: { id: item.id, userId, ...data },
          update: data,
        });
      }
      let sort = 0;
      for (const option of catalog.reminder ?? []) {
        await tx.taskOption.upsert({
          where: { userId_kind_name: { userId, kind: "REMINDER", name: option.name } },
          create: { userId, kind: "REMINDER", name: option.name, color: option.color, sort },
          update: { color: option.color, sort },
        });
        sort += 1;
      }
      await tx.notionConnection.update({ where: { userId }, data: { remindersInDb: true } });
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  return { imported: reminders.length };
}

/** Notionから取り込まず、空の日付リマインドDBで始める。 */
export async function startRemindersInDb(userId: string): Promise<void> {
  await db.notionConnection.update({ where: { userId }, data: { remindersInDb: true } });
}
