import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { createTaskDatabase } from "@/services/notion/task-database";

type Body = { parentPageId?: string; title?: string };

/**
 * 必要なプロパティを揃えたタスクDBをNotionに作成し、そのままDaySpanのタスクDBとして設定する。
 * ユーザーが設定画面で明示的に選んだときだけ実行される（docs/spec.md §9）。
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
  if (!body.parentPageId) {
    return NextResponse.json({ error: "parentPageId is required" }, { status: 400 });
  }

  const title = body.title?.trim() || "DaySpan タスク";

  let created;
  try {
    created = await createTaskDatabase(createNotionClient(connection), {
      parentPageId: body.parentPageId,
      title,
    });
  } catch {
    return NextResponse.json({ error: "notion_request_failed" }, { status: 502 });
  }

  await db.notionConnection.update({
    where: { userId },
    data: {
      taskDataSourceId: created.dataSourceId,
      taskDatabaseId: created.databaseId,
      taskTitle: created.title,
      propertyMap: created.propertyMap,
      lastValidatedAt: new Date(),
    },
  });

  return NextResponse.json({
    taskDataSourceId: created.dataSourceId,
    taskTitle: created.title,
  });
}
