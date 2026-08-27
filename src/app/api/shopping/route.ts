import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionShoppingConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { createShoppingItem, type ShoppingWriteInput } from "@/services/notion/shopping-items";

import { validateShoppingBody } from "./shared";

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
