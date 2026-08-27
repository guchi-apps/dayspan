import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { createShoppingDatabase } from "@/services/notion/shopping-database";

type Body = { parentPageId?: string; title?: string };

/**
 * 必要なプロパティを揃えた買い物リストDBをNotionに作成し、そのままDaySpanの買い物リストDBとして
 * 設定する。タスクDB・場所DB・勤務記録DBと同じく、設定画面で明示的に選んだときだけ実行される
 * （docs/spec.md §36）。
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

  const title = body.title?.trim() || "DaySpan 買い物リスト";

  let created;
  try {
    created = await createShoppingDatabase(createNotionClient(connection), {
      parentPageId: body.parentPageId,
      title,
    });
  } catch (error) {
    return externalApiError("notion", "買い物リストDBの作成", error);
  }

  await db.notionConnection.update({
    where: { userId },
    data: {
      shoppingDataSourceId: created.dataSourceId,
      shoppingDatabaseId: created.databaseId,
      shoppingTitle: created.title,
      shoppingPropertyMap: created.propertyMap,
      lastValidatedAt: new Date(),
    },
  });

  return NextResponse.json({
    shoppingDataSourceId: created.dataSourceId,
    shoppingTitle: created.title,
  });
}
