import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import {
  addPlaceTextProperty,
  isPlaceOptionalField,
  PLACE_DATABASE_TEMPLATE,
} from "@/services/notion/place-database";

/**
 * 使用中の場所DBへ、あとから増えた任意のプロパティ（座標・最寄り駅）を足す（docs/spec.md §9）。
 *
 * 地図からの登録・Yahoo!乗換案内を駅名で開く仕組みより前に作った場所DBには置き場所が無い。
 * 設定画面から実行できるようにしておかないと、Notion側で何という名前・どの型のプロパティを
 * 足せばよいかが画面に出ていない。
 *
 * 項目ごとに経路を分けないのは、やることが同じで、増えるたびに同じ処理が1本ずつ増えるため。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { field?: unknown } | null;
  const field = body?.field;
  if (!isPlaceOptionalField(field)) {
    return NextResponse.json({ error: "unsupported_field" }, { status: 400 });
  }

  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection?.placeDataSourceId) {
    return NextResponse.json({ error: "place_database_not_selected" }, { status: 404 });
  }

  let validation;
  try {
    validation = await addPlaceTextProperty(
      createNotionClient(connection),
      connection.placeDataSourceId,
      field,
    );
  } catch (error) {
    return externalApiError("notion", `「${PLACE_DATABASE_TEMPLATE[field]}」プロパティの追加`, error);
  }

  await db.notionConnection.update({
    where: { userId },
    data: { placePropertyMap: validation.propertyMap, lastValidatedAt: new Date() },
  });

  return NextResponse.json(validation);
}
