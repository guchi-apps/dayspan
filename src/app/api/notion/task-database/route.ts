import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { validateTaskDataSource } from "@/services/notion/task-database";

type Body = { dataSourceId?: string };

/**
 * 選択されたデータソースがタスクDBとして必要な構成を満たすか検証し、
 * 満たしていればプロパティ対応表とあわせて保存する（docs/spec.md §9）。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection) {
    return NextResponse.json({ error: "not_connected" }, { status: 404 });
  }

  const body = (await request.json()) as Body;
  if (!body.dataSourceId) {
    return NextResponse.json({ error: "dataSourceId is required" }, { status: 400 });
  }

  let validation;
  try {
    const notion = createNotionClient(connection);
    validation = await validateTaskDataSource(notion, body.dataSourceId);
  } catch {
    return NextResponse.json({ error: "notion_request_failed" }, { status: 502 });
  }

  // 必須プロパティが欠けている場合は保存せず、何を追加すればよいかを返して案内する。
  if (validation.missingRequired.length > 0) {
    return NextResponse.json(
      {
        error: "missing_properties",
        missingRequired: validation.missingRequired,
        missingOptional: validation.missingOptional,
      },
      { status: 422 },
    );
  }

  await db.notionConnection.update({
    where: { userId },
    data: {
      taskDataSourceId: body.dataSourceId,
      taskDatabaseId: validation.databaseId,
      taskTitle: validation.title,
      propertyMap: validation.propertyMap,
      lastValidatedAt: new Date(),
    },
  });

  return NextResponse.json({
    taskDataSourceId: body.dataSourceId,
    taskTitle: validation.title,
    propertyMap: validation.propertyMap,
    missingOptional: validation.missingOptional,
  });
}
