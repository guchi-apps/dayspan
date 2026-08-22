import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";

import { requireUserId } from "@/lib/auth-user";
import { getNotionConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import {
  completeTask,
  deleteTask,
  updateTask,
  type TaskWriteInput,
} from "@/services/notion/tasks";
import { getTaskLinkByTaskId, unlinkTask, unlinkTaskByTaskId } from "@/services/task-links/links";
import { isSameTaskDate } from "@/services/task-links/stage";
import { TASK_LINK_TARGETS, type TaskLinkTarget } from "@/types/calendar";

type Body = TaskWriteInput & { completeAction?: boolean };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  const { taskId } = await params;
  const body = (await request.json()) as Body;
  const notion = createNotionClient(connection);

  try {
    // 完了操作は繰り返しの次回作成を伴うため、単なるプロパティ更新とは経路を分ける
    // （docs/spec.md §13）。
    if (body.completeAction && body.done !== undefined) {
      const result = await completeTask(notion, connection, taskId, body.done);
      return NextResponse.json({ ok: true, nextTaskId: result.nextTaskId });
    }

    await updateTask(notion, connection, taskId, body);
    await dropLinksIfDateOverridden(userId, taskId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return externalApiError("notion", "タスクの更新", error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  const { taskId } = await params;

  try {
    await deleteTask(createNotionClient(connection), taskId);
    // 消したタスクの紐づけは残しても指す先が無い。予定を動かすたびに、消えたページへ
    // 日付を書きにいくことにもなる。
    await unlinkTaskByTaskId(userId, taskId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return externalApiError("notion", "タスクの削除", error);
  }
}

/**
 * 期限・予定日を紐づけとは違う日時に書き換えられたときは、その行き先の紐づけを外す。
 *
 * 入力画面では紐づけ中の日付を直接は直せないようにしているが、隠すだけだとDaySpanのAPIや
 * 将来のMCPから直接呼ばれた要求が素通りする（docs/spec.md §22）。紐づけを残したままにすると、
 * 手で入れた日付が次に予定が動いた時点で黙って書き戻される。
 *
 * 外すのは書き換えられた行き先の紐づけだけにする。期限を直したからといって、予定日の紐づけまで
 * 外す理由は無い。
 */
async function dropLinksIfDateOverridden(
  userId: string,
  taskId: string,
  body: Body,
): Promise<void> {
  for (const target of TASK_LINK_TARGETS) {
    const date = target === "DUE" ? body.due : body.planned;
    await dropLinkIfDateOverridden(userId, taskId, target, date);
  }
}

async function dropLinkIfDateOverridden(
  userId: string,
  taskId: string,
  target: TaskLinkTarget,
  date: string | null | undefined,
): Promise<void> {
  if (date === undefined) return;

  const link = await getTaskLinkByTaskId(userId, taskId, target);
  if (!link) return;

  // 日付を空にされた場合も紐づけは外す（date が null なら一致しない）。
  const resolved = link.resolvedAt.toISOString();
  const same = isSameTaskDate(
    { date, allDay: date ? !date.includes("T") : false },
    {
      date: link.resolvedAllDay ? resolved.slice(0, 10) : resolved,
      allDay: link.resolvedAllDay,
    },
  );

  if (!same) await unlinkTask(userId, link.id);
}
