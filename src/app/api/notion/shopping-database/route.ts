import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { validateShoppingDataSource } from "@/services/notion/shopping-database";

/**
 * 買い物リストDB（docs/spec.md §36）を選ぶ。
 *
 * 必須は項目（タイトル）だけ。カテゴリ・優先度はどちらも select のため名前が当たったときだけ
 * 対応付ける（型だけで割り当てると入れ替わりうる）。揃っていないぶんは missingOptional で返し、
 * 何を足せば使えるようになるのかを設定画面に出す。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const { dataSourceId } = (await request.json()) as { dataSourceId?: string };
  if (!dataSourceId) {
    return NextResponse.json({ error: "dataSourceId is required" }, { status: 400 });
  }

  let validation;
  try {
    validation = await validateShoppingDataSource(createNotionClient(connection), dataSourceId);
  } catch (error) {
    return externalApiError("notion", "買い物リストDBの検証", error);
  }

  if (validation.missingRequired.length) {
    return NextResponse.json({ error: "missing_properties", ...validation }, { status: 422 });
  }

  await db.notionConnection.update({
    where: { userId },
    data: {
      shoppingDataSourceId: dataSourceId,
      shoppingDatabaseId: validation.databaseId,
      shoppingTitle: validation.title,
      shoppingPropertyMap: validation.propertyMap,
      lastValidatedAt: new Date(),
    },
  });

  return NextResponse.json(validation);
}
