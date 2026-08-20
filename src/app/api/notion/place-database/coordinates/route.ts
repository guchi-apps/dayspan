import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { addPlaceCoordinatesProperty } from "@/services/notion/place-database";

/**
 * 使用中の場所DBへ「座標」プロパティを足す（docs/spec.md §9）。
 *
 * 地図からの登録より前に作った場所DBには座標の置き場所が無い。設定画面から実行できるように
 * しておかないと、Notion側で何という名前・どの型のプロパティを足せばよいかが画面に出ていない。
 */
export async function POST() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection?.placeDataSourceId) {
    return NextResponse.json({ error: "place_database_not_selected" }, { status: 404 });
  }

  let validation;
  try {
    validation = await addPlaceCoordinatesProperty(
      createNotionClient(connection),
      connection.placeDataSourceId,
    );
  } catch (error) {
    return externalApiError("notion", "座標プロパティの追加", error);
  }

  await db.notionConnection.update({
    where: { userId },
    data: { placePropertyMap: validation.propertyMap, lastValidatedAt: new Date() },
  });

  return NextResponse.json(validation);
}
