import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionShoppingConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import {
  createShoppingItem,
  listShoppingItems,
  shoppingDatabaseReady,
  type ShoppingWriteInput,
} from "@/services/notion/shopping-items";
import { loadTagOptions } from "@/services/notion/tag-options";

import { validateShoppingBody } from "./shared";

/**
 * 買い物リストの一覧とカテゴリの選択肢（docs/spec.md §36）。
 *
 * 画面はこれを背景取得し、Service Worker が通信の遅いときに保存済みを返す（issue #724）。
 * カテゴリの取得は失敗しても空になるだけで、一覧の表示は妨げない。
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await getNotionShoppingConnection(userId);
  if (!connection || !shoppingDatabaseReady(connection)) {
    return NextResponse.json({ error: "shopping_database_not_selected" }, { status: 404 });
  }

  try {
    const [items, categoryOptions] = await Promise.all([
      listShoppingItems(createNotionClient(connection), connection),
      loadTagOptions(connection, "shopping"),
    ]);
    return NextResponse.json({ items, categoryOptions: categoryOptions ?? [] });
  } catch (error) {
    return externalApiError("notion", "買い物リストの取得", error);
  }
}

/** 買い物リストへ1件足す（docs/spec.md §36）。 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await getNotionShoppingConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "shopping_database_not_selected" }, { status: 404 });
  }

  const body = (await request.json()) as ShoppingWriteInput;
  const invalid = validateShoppingBody(body, { requireName: true });
  if (invalid) return invalid;

  try {
    const item = await createShoppingItem(createNotionClient(connection), connection, {
      ...body,
      name: body.name!.trim(),
      memo: body.memo?.trim() || null,
    });
    return NextResponse.json({ item });
  } catch (error) {
    return externalApiError("notion", "買い物リストの追加", error);
  }
}
