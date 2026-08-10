import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionReminderConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { deleteReminder, updateReminder, type ReminderWriteInput } from "@/services/notion/reminders";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reminderId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionReminderConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  const { reminderId } = await params;
  const body = (await request.json()) as ReminderWriteInput;

  try {
    await updateReminder(createNotionClient(connection), connection, reminderId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return externalApiError("notion", "日付リマインドの更新", error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ reminderId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionReminderConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  const { reminderId } = await params;

  try {
    await deleteReminder(createNotionClient(connection), reminderId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return externalApiError("notion", "日付リマインドの削除", error);
  }
}
