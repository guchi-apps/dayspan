import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { parseCoordinates } from "@/lib/coordinates";
import { getNotionPlaceConnection } from "@/services/calendar/write-context";
import {
  deletePlace,
  PlaceNameTakenError,
  PlaceNotEditableError,
  updatePlace,
} from "@/services/notion/places";

/**
 * 場所DB以外のページ（タスク・日付リマインドなど）への書き込みは、経路によらず断る。
 * 応答は毎回作る（NextResponseの本文はストリームで、使い回すと2回目が空になる）。
 */
const notEditable = () =>
  NextResponse.json(
    { error: "not_editable", message: "この場所はDaySpanからは変更できません。" },
    { status: 403 },
  );

/**
 * 登録済みの場所を書き換える（docs/spec.md §9）。
 *
 * 本文は書き換えたあとの姿を表す。`address` / `coordinates` は `null` で「消す」、
 * **項目ごと渡さないと「触らない」**になる。読めない値が入っている欄を、開いて保存した
 * だけで消さないようにするため。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ placeId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await getNotionPlaceConnection(userId);
  if (!connection) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const { placeId } = await params;
  const body = (await request.json()) as {
    name?: string;
    address?: string | null;
    /** `"35.658034,139.701636"` の形。読めない値・null は「地点なし」として扱う。 */
    coordinates?: string | null;
  };

  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  try {
    const place = await updatePlace(connection, placeId, {
      name,
      ...("address" in body ? { address: body.address?.trim() || null } : {}),
      ...("coordinates" in body ? { coordinates: parseCoordinates(body.coordinates) } : {}),
    });
    return NextResponse.json(place);
  } catch (error) {
    if (error instanceof PlaceNotEditableError) return notEditable();
    if (error instanceof PlaceNameTakenError) {
      return NextResponse.json(
        {
          error: "name_taken",
          message: `「${error.placeName}」はすでに登録されています。別の名前を入力してください。`,
        },
        { status: 409 },
      );
    }
    return externalApiError("notion", "場所の更新", error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ placeId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await getNotionPlaceConnection(userId);
  if (!connection) return NextResponse.json({ error: "not_connected" }, { status: 404 });

  const { placeId } = await params;

  try {
    await deletePlace(connection, placeId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PlaceNotEditableError) return notEditable();
    return externalApiError("notion", "場所の削除", error);
  }
}
