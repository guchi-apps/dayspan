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
    return NextResponse.json({ ok: true });
  } catch (error) {
    return externalApiError("notion", "タスクの削除", error);
  }
}
