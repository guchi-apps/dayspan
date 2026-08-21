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
import { getTaskLinkByTaskId, unlinkTaskByTaskId } from "@/services/task-links/links";
import { isSameTaskDate } from "@/services/task-links/stage";

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
    await dropLinkIfPlannedOverridden(userId, taskId, body);
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
    // 予定日を書きにいくことにもなる。
    await unlinkTaskByTaskId(userId, taskId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return externalApiError("notion", "タスクの削除", error);
  }
}

/**
 * 予定日を紐づけとは違う日時に書き換えられたときは、紐づけを外す。
 *
 * 入力画面では紐づけ中の予定日を直接は直せないようにしているが、隠すだけだとDaySpanのAPIや
 * 将来のMCPから直接呼ばれた要求が素通りする（docs/spec.md §22）。紐づけを残したままにすると、
 * 手で入れた日付が次に予定が動いた時点で黙って書き戻される。
 */
async function dropLinkIfPlannedOverridden(
  userId: string,
  taskId: string,
  body: Body,
): Promise<void> {
  if (body.planned === undefined) return;

  const link = await getTaskLinkByTaskId(userId, taskId);
  if (!link) return;

  // 予定日を空にされた場合も紐づけは外す（date が null なら一致しない）。
  const planned = body.planned;
  const resolved = link.resolvedAt.toISOString();
  const same = isSameTaskDate(
    { date: planned, allDay: planned ? !planned.includes("T") : false },
    {
      date: link.resolvedAllDay ? resolved.slice(0, 10) : resolved,
      allDay: link.resolvedAllDay,
    },
  );

  if (!same) await unlinkTaskByTaskId(userId, taskId);
}
