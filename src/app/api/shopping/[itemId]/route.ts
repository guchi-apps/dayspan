import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionShoppingConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import {
  deleteShoppingItem,
  ShoppingItemNotEditableError,
  updateShoppingItem,
  type ShoppingWriteInput,
} from "@/services/notion/shopping-items";

import { notEditable, validateShoppingBody } from "../shared";

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await getNotionShoppingConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "shopping_database_not_selected" }, { status: 404 });
  }

  const { itemId } = await params;
  const body = (await request.json()) as ShoppingWriteInput;
  const invalid = validateShoppingBody(body, { requireName: false });
  if (invalid) return invalid;

  try {
    await updateShoppingItem(createNotionClient(connection), connection, itemId, {
      ...body,
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.memo !== undefined ? { memo: body.memo?.trim() || null } : {}),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ShoppingItemNotEditableError) return notEditable();
    return externalApiError("notion", "買い物リストの更新", error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await getNotionShoppingConnection(userId);
  if (!connection) {
    return NextResponse.json({ error: "shopping_database_not_selected" }, { status: 404 });
  }

  const { itemId } = await params;

  try {
    await deleteShoppingItem(createNotionClient(connection), connection, itemId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ShoppingItemNotEditableError) return notEditable();
    return externalApiError("notion", "買い物リストの削除", error);
  }
}
