import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { getNotionConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { createTask, type TaskWriteInput } from "@/services/notion/tasks";

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
  } catch {
    return NextResponse.json({ error: "notion_request_failed" }, { status: 502 });
  }
}
