import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { getNotionPlaceConnection } from "@/services/calendar/write-context";
import { createPlace } from "@/services/notion/places";

/** 場所を1件登録する。AIの提案を採ったときに、次からNotion側の候補として出せるようにする。 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await getNotionPlaceConnection(userId);
  if (!connection) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const body = (await request.json()) as { name?: string; address?: string | null };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  try {
    const place = await createPlace(connection, { name, address: body.address?.trim() || null });
    return NextResponse.json(place);
  } catch (error) {
    return externalApiError("notion", "場所の登録", error);
  }
}
