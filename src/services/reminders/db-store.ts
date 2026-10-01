import type { Prisma, Reminder } from "@prisma/client";

import { db } from "@/lib/db";
import type { ReminderItem } from "@/types/calendar";

import { expandAnnual, ReminderNotEditableError, type ReminderWriteInput } from "@/services/notion/reminders";

// 日付リマインドの本体をYoteiFlowのDBに置く経路（issue #928）。Notionが応答しなくても読み書きできる。
// 公開する関数は services/notion/reminders.ts と同じ意味で、services/reminders/index.ts が切り替える。

export function toReminderItem(row: Reminder): ReminderItem {
  return {
    kind: "reminder",
    source: "reminder",
    id: row.id,
    pageId: row.id,
    title: row.title,
    date: row.date,
    sourceDate: row.date,
    hasTime: row.date.includes("T"),
    category: row.category,
    memo: row.memo,
    annual: row.annual,
    url: null,
  };
}

export async function listAllRemindersFromDb(userId: string): Promise<ReminderItem[]> {
  const rows = await db.reminder.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return rows.map(toReminderItem);
}

/** 範囲（日付部分）に入る項目と、範囲の各年へ展開した毎年の項目。Notion版と同じ規則。 */
export async function listRemindersInRangeFromDb(
  userId: string,
  range: { from: string; to: string },
): Promise<ReminderItem[]> {
  const rows = await db.reminder.findMany({
    where: {
      userId,
      OR: [{ annual: true }, { date: { gte: range.from, lte: `${range.to}￿` } }],
    },
    orderBy: { createdAt: "asc" },
  });
  const items = rows.map(toReminderItem);
  const annual = items.filter((item) => item.annual);
  const annualIds = new Set(annual.map((item) => item.id));
  const dated = items.filter(
    (item) =>
      !annualIds.has(item.id) && item.date.slice(0, 10) >= range.from && item.date.slice(0, 10) <= range.to,
  );
  return [...dated, ...annual.flatMap((item) => expandAnnual(item, range))];
}

/** 入力に現れた種類が選択肢に無ければ足す。 */
async function ensureCategory(userId: string, category: string | null | undefined): Promise<void> {
  if (!category) return;
  const kind = "REMINDER" as const;
  const exists = await db.taskOption.findUnique({
    where: { userId_kind_name: { userId, kind, name: category } },
  });
  if (exists) return;
  const last = await db.taskOption.aggregate({ where: { userId, kind }, _max: { sort: true } });
  await db.taskOption.create({ data: { userId, kind, name: category, sort: (last._max.sort ?? -1) + 1 } });
}

function toData(input: ReminderWriteInput): Prisma.ReminderUpdateManyMutationInput {
  const data: Prisma.ReminderUpdateManyMutationInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.date !== undefined) data.date = input.date;
  if (input.category !== undefined) data.category = input.category || null;
  if (input.memo !== undefined) data.memo = input.memo || null;
  if (input.annual !== undefined) data.annual = input.annual;
  return data;
}

export async function createReminderInDb(
  userId: string,
  input: ReminderWriteInput,
): Promise<{ id: string }> {
  await ensureCategory(userId, input.category);
  const row = await db.reminder.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      title: input.title ?? "",
      date: input.date ?? "",
      category: input.category || null,
      memo: input.memo || null,
      annual: input.annual ?? false,
    },
  });
  return { id: row.id };
}

export async function updateReminderInDb(
  userId: string,
  reminderId: string,
  input: ReminderWriteInput,
): Promise<void> {
  await ensureCategory(userId, input.category);
  const result = await db.reminder.updateMany({ where: { id: reminderId, userId }, data: toData(input) });
  if (result.count === 0) throw new ReminderNotEditableError();
}

export async function deleteReminderInDb(userId: string, reminderId: string): Promise<void> {
  const result = await db.reminder.deleteMany({ where: { id: reminderId, userId } });
  if (result.count === 0) throw new ReminderNotEditableError();
}

/** 種類の選択肢（TagOption と同じ形）。 */
export async function loadReminderOptionsFromDb(userId: string) {
  const rows = await db.taskOption.findMany({
    where: { userId, kind: "REMINDER" },
    orderBy: [{ sort: "asc" }, { name: "asc" }],
  });
  return rows.map((row) => ({ id: row.id, name: row.name, color: row.color }));
}
