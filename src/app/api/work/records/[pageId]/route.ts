import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionWorkConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import {
  deleteWorkRecord,
  updateWorkRecord,
  WorkDateTakenError,
  WorkRecordNotEditableError,
  type WorkWriteInput,
} from "@/services/notion/work-logs";

import { dateTaken, notEditable, validateWorkBody } from "../../shared";

export async function PATCH(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionWorkConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "work_database_not_selected" }, { status: 404 });
  }

  const { pageId } = await params;
  const body = (await request.json()) as WorkWriteInput;
  const invalid = validateWorkBody(body, { requireStartDate: false });
  if (invalid) return invalid;

  try {
    await updateWorkRecord(createNotionClient(connection), connection, pageId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof WorkRecordNotEditableError) return notEditable();
    if (error instanceof WorkDateTakenError) return dateTaken();
    return externalApiError("notion", "勤務記録の更新", error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ pageId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionWorkConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "work_database_not_selected" }, { status: 404 });
  }

  const { pageId } = await params;

  try {
    await deleteWorkRecord(createNotionClient(connection), connection, pageId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof WorkRecordNotEditableError) return notEditable();
    return externalApiError("notion", "勤務記録の削除", error);
  }
}
