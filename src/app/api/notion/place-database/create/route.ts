import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { createPlaceDatabase } from "@/services/notion/place-database";

type Body = { parentPageId?: string; title?: string };

/**
 * 必要なプロパティを揃えた場所DBをNotionに作成し、そのままDaySpanの場所DBとして設定する。
 * タスクDBと同じく、設定画面で明示的に選んだときだけ実行される（docs/spec.md §9）。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const body = (await request.json()) as Body;
  if (!body.parentPageId) {
    return NextResponse.json({ error: "parentPageId is required" }, { status: 400 });
  }

  const title = body.title?.trim() || "DaySpan 場所";

  let created;
  try {
    created = await createPlaceDatabase(createNotionClient(connection), {
      parentPageId: body.parentPageId,
      title,
    });
  } catch (error) {
    return externalApiError("notion", "場所DBの作成", error);
  }

  await db.notionConnection.update({
    where: { userId },
    data: {
      placeDataSourceId: created.dataSourceId,
      placeDatabaseId: created.databaseId,
      placeTitle: created.title,
      placePropertyMap: created.propertyMap,
      lastValidatedAt: new Date(),
    },
  });

  return NextResponse.json({ placeDataSourceId: created.dataSourceId, placeTitle: created.title });
}
