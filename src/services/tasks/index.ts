import type { NotionConnection } from "@prisma/client";

import { db } from "@/lib/db";
import type { TaskItem } from "@/types/calendar";

import { createNotionClient } from "@/services/notion/client";
import type { OverdueTaskRange } from "@/services/notion/task-query-filter";
import * as notionTasks from "@/services/notion/tasks";
import { loadTagCatalog } from "@/services/notion/tag-options";

import {
  completeTaskInDb,
  createTaskInDb,
  deleteTaskInDb,
  listAllTasksFromDb,
  listTasksInRangeFromDb,
  skipTaskInDb,
  updateTaskInDb,
} from "./db-store";

export { TaskNotEditableError } from "@/services/notion/tasks";
export type { TaskWriteInput } from "@/services/notion/tasks";

// タスクの読み書きの入口（issue #919）。`NotionConnection.tasksInDb` が true ならYoteiFlowのDB、
// false なら従来どおりNotionを使う。呼び出し側はどちらかを意識しない。

/** タスクを扱える状態か（DBに置く、またはNotionのタスクDBを選んでいる）。 */
export function taskSourceReady(connection: NotionConnection | null | undefined): boolean {
  return Boolean(connection && (connection.tasksInDb || connection.taskDataSourceId));
}

export async function listTasksInRange(
  connection: NotionConnection,
  range: { from: string; to: string },
  options?: { overdueRange?: OverdueTaskRange },
): Promise<TaskItem[]> {
  if (connection.tasksInDb) {
    return listTasksInRangeFromDb(connection.userId, range, options?.overdueRange);
  }
  return notionTasks.listTasksInRange(createNotionClient(connection), connection, range, options);
}

export async function listAllTasks(connection: NotionConnection): Promise<TaskItem[]> {
  if (connection.tasksInDb) return listAllTasksFromDb(connection.userId);
  return notionTasks.listAllTasks(createNotionClient(connection), connection);
}

export async function createTask(
  connection: NotionConnection,
  input: notionTasks.TaskWriteInput,
): Promise<{ id: string }> {
  if (connection.tasksInDb) return createTaskInDb(connection.userId, input);
  return notionTasks.createTask(createNotionClient(connection), connection, input);
}

export async function updateTask(
  connection: NotionConnection,
  taskId: string,
  input: notionTasks.TaskWriteInput,
): Promise<void> {
  if (connection.tasksInDb) return updateTaskInDb(connection.userId, taskId, input);
  return notionTasks.updateTask(createNotionClient(connection), connection, taskId, input);
}

export async function completeTask(
  connection: NotionConnection,
  taskId: string,
  done: boolean,
): Promise<{ nextTaskId: string | null }> {
  if (connection.tasksInDb) return completeTaskInDb(connection.userId, taskId, done);
  return notionTasks.completeTask(createNotionClient(connection), connection, taskId, done);
}

export async function skipTask(
  connection: NotionConnection,
  taskId: string,
  skipped: boolean,
): Promise<void> {
  if (connection.tasksInDb) return skipTaskInDb(connection.userId, taskId, skipped);
  return notionTasks.skipTask(createNotionClient(connection), connection, taskId, skipped);
}

export async function deleteTask(connection: NotionConnection, taskId: string): Promise<void> {
  if (connection.tasksInDb) return deleteTaskInDb(connection.userId, taskId);
  return notionTasks.deleteTask(createNotionClient(connection), connection, taskId);
}

/**
 * NotionのタスクをYoteiFlowのDBへ取り込み、以後はDBを正にする。
 * 何度実行しても同じ結果になる（idはNotionのページID。取り込み済みの行は上書きする）。
 * Notionが応答しない間は取り込めないため、その場合は失敗を返し、`tasksInDb` は変えない。
 */
export async function importTasksFromNotion(
  connection: NotionConnection,
): Promise<{ imported: number }> {
  if (!connection.taskDataSourceId) throw new Error("Task data source is not configured");

  const tasks = await notionTasks.listAllTasks(createNotionClient(connection), connection);
  // 選択肢と並び順・色もNotionのプロパティ定義から写す。取れなければ空で、保存時に補われる。
  const catalog = await loadTagCatalog(connection);
  const userId = connection.userId;

  await db.$transaction(async (tx) => {
    for (const task of tasks) {
      const data = {
        title: task.title,
        due: task.due,
        planned: task.planned,
        done: task.done && !task.skipped,
        skipped: task.skipped,
        progress: task.progress,
        priority: task.priority,
        tags: task.tags,
        memo: task.memo,
        recurrence: task.recurrence,
      };
      await tx.task.upsert({
        where: { id: task.id },
        create: { id: task.id, userId, ...data },
        update: data,
      });
    }
    const kinds = [
      ["TAG", catalog.task],
      ["PROGRESS", catalog.progress],
    ] as const;
    for (const [kind, options] of kinds) {
      let sort = 0;
      for (const option of options ?? []) {
        await tx.taskOption.upsert({
          where: { userId_kind_name: { userId, kind, name: option.name } },
          create: { userId, kind, name: option.name, color: option.color, sort },
          update: { color: option.color, sort },
        });
        sort += 1;
      }
    }
    await tx.notionConnection.update({ where: { userId }, data: { tasksInDb: true } });
  }, { timeout: 120_000, maxWait: 10_000 });

  return { imported: tasks.length };
}

/** Notionから取り込まず、空のタスクDBで始める（Notionが応答しない間でも切り替えられる）。 */
export async function startTasksInDb(userId: string): Promise<void> {
  await db.notionConnection.update({ where: { userId }, data: { tasksInDb: true } });
}
