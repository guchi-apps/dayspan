import type { Prisma, Task } from "@prisma/client";

import { db } from "@/lib/db";
import type { TaskItem } from "@/types/calendar";

import { formatRecurrence, nextDue, parseRecurrence } from "@/services/notion/recurrence";
import { SKIPPED_OUTCOME } from "@/services/notion/task-database";
import { TaskNotEditableError, type TaskWriteInput } from "@/services/notion/tasks";
import type { OverdueTaskRange } from "@/services/notion/task-query-filter";

// タスクの本体をYoteiFlowのDBに置く経路（issue #919）。Notionが応答しなくても読み書きできる。
// 公開する関数は services/notion/tasks.ts と同じ意味で、services/tasks/index.ts が切り替える。

export function toTaskItem(row: Task): TaskItem {
  return {
    kind: "task",
    id: row.id,
    title: row.title,
    due: row.due,
    hasTime: Boolean(row.due?.includes("T")),
    planned: row.planned,
    plannedHasTime: Boolean(row.planned?.includes("T")),
    // 「対応しない」は完了と同じく片付いたものとして扱う（docs/spec.md §12）。
    done: row.done || row.skipped,
    skipped: row.skipped,
    // 自前のDBなので対応状況・進捗はいつでも持てる。
    canSkip: true,
    progress: row.progress,
    canProgress: true,
    priority: row.priority,
    tags: Array.isArray(row.tags) ? (row.tags as unknown[]).filter((t): t is string => typeof t === "string") : [],
    memo: row.memo,
    recurrence: row.recurrence,
    links: [],
    url: null,
  };
}

const dayOf = (value: string | null): string | null => (value ? value.slice(0, 10) : null);

/**
 * 範囲に期限または予定日があるタスク（完了を除く）。Notion版（taskRangeFilter）と同じく
 * 日付部分で比べ、期限切れの追加分は期限だけを見る（issue #817）。
 */
export async function listTasksInRangeFromDb(
  userId: string,
  range: { from: string; to: string },
  overdue?: OverdueTaskRange,
): Promise<TaskItem[]> {
  const rows = await db.task.findMany({
    where: { userId, done: false, skipped: false },
    orderBy: { createdAt: "asc" },
  });
  const within = (day: string | null) => day !== null && day >= range.from && day <= range.to;

  return rows
    .filter((row) => {
      const due = dayOf(row.due);
      const planned = dayOf(row.planned);
      if (within(due) || within(planned)) return true;
      return Boolean(overdue && due !== null && due >= overdue.from && due < overdue.before);
    })
    .map(toTaskItem);
}

export async function listAllTasksFromDb(userId: string): Promise<TaskItem[]> {
  const rows = await db.task.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return rows.map(toTaskItem);
}

/** 入力に現れたタグ・進捗が選択肢に無ければ足す（Notionの select が未知の名前で増えるのと同じ）。 */
async function ensureOptions(userId: string, input: TaskWriteInput): Promise<void> {
  const wanted: Array<{ kind: "TAG" | "PROGRESS"; name: string }> = [
    ...(input.tags ?? []).map((name) => ({ kind: "TAG" as const, name })),
    ...(input.progress ? [{ kind: "PROGRESS" as const, name: input.progress }] : []),
  ];
  for (const { kind, name } of wanted) {
    const exists = await db.taskOption.findUnique({
      where: { userId_kind_name: { userId, kind, name } },
    });
    if (exists) continue;
    const last = await db.taskOption.aggregate({
      where: { userId, kind },
      _max: { sort: true },
    });
    await db.taskOption.create({
      data: { userId, kind, name, sort: (last._max.sort ?? -1) + 1 },
    });
  }
}

function toData(input: TaskWriteInput): Prisma.TaskUpdateInput {
  const data: Prisma.TaskUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.due !== undefined) data.due = input.due;
  if (input.planned !== undefined) data.planned = input.planned;
  if (input.done !== undefined) data.done = input.done;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.memo !== undefined) data.memo = input.memo || null;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.recurrence !== undefined) data.recurrence = input.recurrence;
  if (input.outcome !== undefined) data.skipped = input.outcome === SKIPPED_OUTCOME;
  if (input.progress !== undefined) data.progress = input.progress;
  return data;
}

export async function createTaskInDb(
  userId: string,
  input: TaskWriteInput,
): Promise<{ id: string }> {
  await ensureOptions(userId, input);
  const row = await db.task.create({
    data: {
      id: crypto.randomUUID(),
      userId,
      title: input.title ?? "",
      due: input.due ?? null,
      planned: input.planned ?? null,
      done: input.done ?? false,
      skipped: input.outcome === SKIPPED_OUTCOME,
      progress: input.progress ?? null,
      priority: input.priority ?? null,
      tags: input.tags ?? [],
      memo: input.memo || null,
      recurrence: input.recurrence ?? null,
    },
  });
  return { id: row.id };
}

export async function updateTaskInDb(
  userId: string,
  taskId: string,
  input: TaskWriteInput,
): Promise<void> {
  await ensureOptions(userId, input);
  const result = await db.task.updateMany({
    where: { id: taskId, userId },
    data: toData(input) as Prisma.TaskUpdateManyMutationInput,
  });
  if (result.count === 0) throw new TaskNotEditableError();
}

export async function completeTaskInDb(
  userId: string,
  taskId: string,
  done: boolean,
): Promise<{ nextTaskId: string | null }> {
  const current = await db.task.findFirst({ where: { id: taskId, userId } });
  if (!current) throw new TaskNotEditableError();

  // 「対応しない」から完了へ変える操作では対応状況を外す（完了と対応しないは両立しない）。
  await db.task.update({
    where: { id: taskId },
    data: { done, ...(current.skipped ? { skipped: false } : {}) },
  });

  if (!done) return { nextTaskId: null };
  const recurrence = parseRecurrence(current.recurrence);
  const due = nextDue(current.due, recurrence);
  if (!due) return { nextTaskId: null };

  const item = toTaskItem(current);
  const created = await createTaskInDb(userId, {
    title: item.title,
    due,
    planned: nextDue(item.planned, recurrence),
    done: false,
    priority: item.priority,
    memo: item.memo,
    tags: item.tags,
    recurrence: formatRecurrence(recurrence),
  });
  return { nextTaskId: created.id };
}

export async function skipTaskInDb(
  userId: string,
  taskId: string,
  skipped: boolean,
): Promise<void> {
  await updateTaskInDb(userId, taskId, {
    done: skipped,
    outcome: skipped ? SKIPPED_OUTCOME : null,
  });
}

export async function deleteTaskInDb(userId: string, taskId: string): Promise<void> {
  const result = await db.task.deleteMany({ where: { id: taskId, userId } });
  if (result.count === 0) throw new TaskNotEditableError();
}

/** タグ・進捗の選択肢（TagCatalog と同じ形）。1件も無ければ空配列。 */
export async function loadTaskOptionsFromDb(userId: string) {
  const rows = await db.taskOption.findMany({
    where: { userId },
    orderBy: [{ sort: "asc" }, { name: "asc" }],
  });
  const pick = (kind: "TAG" | "PROGRESS") =>
    rows
      .filter((row) => row.kind === kind)
      .map((row) => ({ id: row.id, name: row.name, color: row.color }));
  return { task: pick("TAG"), progress: pick("PROGRESS") };
}
