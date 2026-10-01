import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";

import { requireUserId } from "@/lib/auth-user";
import { getNotionConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { createTask, listAllTasks, type TaskWriteInput } from "@/services/notion/tasks";
import { attachTaskLinks, listTaskLinks } from "@/services/task-links/links";

/**
 * 予定へ紐づけるタスクを選ぶための一覧（docs/spec.md §31）。
 *
 * カレンダーが持っているタスクでは足りない。期限も予定日も無いタスクはカレンダーに
 * 出ておらず（docs/spec.md §10）、それこそが「いつやるか決まっていない」＝紐づけたい
 * タスクだからである。完了したタスクは紐づける先が無いため落とす。
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  try {
    const tasks = await listAllTasks(createNotionClient(connection), connection);
    // すでに別の予定へ紐づいているタスクを画面で示せるようにする。紐づけはDaySpanのDBに
    // あるため、外部APIの往復は増えない。
    const links = await listTaskLinks(userId);
    return NextResponse.json({
      tasks: attachTaskLinks(tasks, links).filter((task) => !task.done),
    });
  } catch (error) {
    return externalApiError("notion", "タスクの取得", error);
  }
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  const body = (await request.json()) as TaskWriteInput;
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  try {
    const created = await createTask(createNotionClient(connection), connection, {
      ...body,
      title: body.title.trim(),
    });
    return NextResponse.json({ id: created.id });
  } catch (error) {
    return externalApiError("notion", "タスクの作成", error);
  }
}
