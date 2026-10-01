import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionReminderConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { createReminder, type ReminderWriteInput } from "@/services/notion/reminders";

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionReminderConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  const body = (await request.json()) as ReminderWriteInput;
  if (!body.title?.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!body.date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  try {
    const created = await createReminder(createNotionClient(connection), connection, {
      ...body,
      title: body.title.trim(),
    });
    return NextResponse.json({ id: created.id });
  } catch (error) {
    return externalApiError("notion", "日付リマインドの作成", error);
  }
}
