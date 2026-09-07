import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import {
  addShoppingDateProperty,
  SHOPPING_DATABASE_TEMPLATE,
} from "@/services/notion/shopping-database";

/**
 * 使用中の買い物リストDBへ「購入予定日」を足す（docs/spec.md §36）。
 *
 * 購入予定日より前に作ったDB、および shopping-list アプリが作ったDBには置き場所が無い。
 * Notion側で手で足させると、何という名前・どの型のプロパティにすればよいかが画面に出ていない
 * （場所DBの座標・勤務記録DBの出張と同じ理由で、設定画面から実行できるようにする）。
 */
export async function POST() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection?.shoppingDataSourceId) {
    return NextResponse.json({ error: "shopping_database_not_selected" }, { status: 404 });
  }

  let validation;
  try {
    validation = await addShoppingDateProperty(
      createNotionClient(connection),
      connection.shoppingDataSourceId,
    );
  } catch (error) {
    return externalApiError(
      "notion",
      `「${SHOPPING_DATABASE_TEMPLATE.plannedDate}」プロパティの追加`,
      error,
    );
  }

  await db.notionConnection.update({
    where: { userId },
    data: { shoppingPropertyMap: validation.propertyMap, lastValidatedAt: new Date() },
  });

  return NextResponse.json(validation);
}
