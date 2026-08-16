import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { validateReminderDataSource } from "@/services/notion/reminder-database";

/**
 * ゴミの日DB（docs/spec.md §9）を選ぶ。
 *
 * プロパティ構成は日付リマインドDBの部分集合（タイトル / 日付 / 種類 / メモ）なので、
 * 検証は日付リマインドDBのものをそのまま使う。「毎年」は無くてよい任意項目のため、
 * 未対応でも接続できる。
 */
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
      garbageDataSourceId: dataSourceId,
      garbageDatabaseId: validation.databaseId,
      garbageTitle: validation.title,
      garbagePropertyMap: validation.propertyMap,
      lastValidatedAt: new Date(),
    },
  });
  return NextResponse.json(validation);
}
