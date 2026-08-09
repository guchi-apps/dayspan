import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { validateReminderDataSource } from "@/services/notion/reminder-database";

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection) return NextResponse.json({ error: "not_connected" }, { status: 404 });
  const { dataSourceId } = (await request.json()) as { dataSourceId?: string };
  if (!dataSourceId) return NextResponse.json({ error: "dataSourceId is required" }, { status: 400 });

  let validation;
  try {
    validation = await validateReminderDataSource(createNotionClient(connection), dataSourceId);
  } catch {
    return NextResponse.json({ error: "notion_request_failed" }, { status: 502 });
  }
  if (validation.missingRequired.length) {
    return NextResponse.json({ error: "missing_properties", ...validation }, { status: 422 });
  }
  await db.notionConnection.update({
    where: { userId },
    data: {
      reminderDataSourceId: dataSourceId,
      reminderDatabaseId: validation.databaseId,
      reminderTitle: validation.title,
      reminderPropertyMap: validation.propertyMap,
      lastValidatedAt: new Date(),
    },
  });
  return NextResponse.json(validation);
}
