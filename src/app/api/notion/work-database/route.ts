import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { addWorkTripProperties, validateWorkDataSource } from "@/services/notion/work-database";

/**
 * 勤務記録DB（docs/spec.md §34）を選ぶ。
 *
 * 必須はタイトル・日付・勤務場所の3つ。出張・事前申請・事後登録は名前が当たったときだけ
 * 対応付けるため、既存のDBを選ぶと揃わないことがある。揃っていないぶんは missingOptional で
 * 返し、設定画面から PATCH で足せるようにする。
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
    validation = await validateWorkDataSource(createNotionClient(connection), dataSourceId);
  } catch (error) {
    return externalApiError("notion", "勤務記録DBの検証", error);
  }

  if (validation.missingRequired.length) {
    return NextResponse.json({ error: "missing_properties", ...validation }, { status: 422 });
  }

  await db.notionConnection.update({
    where: { userId },
    data: {
      workDataSourceId: dataSourceId,
      workDatabaseId: validation.databaseId,
      workTitle: validation.title,
      workPropertyMap: validation.propertyMap,
      lastValidatedAt: new Date(),
    },
  });

  return NextResponse.json(validation);
}

/**
 * 使用中の勤務記録DBへ、足りない任意プロパティ（出張・事前申請・事後登録・メモ）を足す。
 *
 * この3つは名前が当たったときだけ対応付けるため、既存のDBを選ぶと揃わない。Notion側で
 * どの型・どの名前で足せばよいかは画面のどこにも出ていないので、ここから実行できるようにする
 * （場所DBの「座標」と同じ経路）。
 */
export async function PATCH() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection?.workDataSourceId) {
    return NextResponse.json({ error: "work_database_not_selected" }, { status: 404 });
  }

  let validation;
  try {
    validation = await addWorkTripProperties(
      createNotionClient(connection),
      connection.workDataSourceId,
    );
  } catch (error) {
    return externalApiError("notion", "出張プロパティの追加", error);
  }

  await db.notionConnection.update({
    where: { userId },
    data: { workPropertyMap: validation.propertyMap, lastValidatedAt: new Date() },
  });

  return NextResponse.json(validation);
}
