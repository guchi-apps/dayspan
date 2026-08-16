import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionReminderConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import {
  deleteReminder,
  ReminderNotEditableError,
  updateReminder,
  type ReminderWriteInput,
} from "@/services/notion/reminders";

/**
 * 日付リマインドDB以外のページ（ゴミの日など）への書き込みは、経路によらず断る。
 * 応答は毎回作る（NextResponseの本文はストリームで、使い回すと2回目が空になる）。
 */
const notEditable = () =>
  NextResponse.json(
    { error: "not_editable", message: "この項目はDaySpanからは変更できません。" },
    { status: 403 },
  );

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
    if (error instanceof ReminderNotEditableError) return notEditable();
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
    await deleteReminder(createNotionClient(connection), connection, reminderId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ReminderNotEditableError) return notEditable();
    return externalApiError("notion", "日付リマインドの削除", error);
  }
}
