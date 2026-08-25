import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionWorkConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import {
  createWorkRecord,
  WorkDateTakenError,
  type WorkWriteInput,
} from "@/services/notion/work-logs";

import { dateTaken, validateWorkBody } from "../shared";

/** 勤務場所・出張を1件作る（docs/spec.md §34）。 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await getNotionWorkConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "work_database_not_selected" }, { status: 404 });
  }

  const body = (await request.json()) as WorkWriteInput;
  const invalid = validateWorkBody(body, { requireStartDate: true });
  if (invalid) return invalid;

  try {
    const created = await createWorkRecord(createNotionClient(connection), connection, {
      ...body,
      startDate: body.startDate!,
      title: body.title?.trim() || body.place || "勤務",
    });
    return NextResponse.json({ record: created });
  } catch (error) {
    if (error instanceof WorkDateTakenError) return dateTaken();
    return externalApiError("notion", "勤務記録の作成", error);
  }
}
