import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import {
  ACTIVITY_NAME_MAX_LENGTH,
  deleteActivityPreset,
  listActivityPresets,
  updateActivityPreset,
} from "@/services/activity/presets";

type Body = { name?: string };

/** 選択肢の名前を変える。保存先カレンダーは項目ごとではなく設定（PATCH /api/activities/settings）で持つ。 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ presetId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { presetId } = await params;
  const body = (await request.json()) as Body;
  const name = body.name?.trim();

  if (name !== undefined) {
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (name.length > ACTIVITY_NAME_MAX_LENGTH) {
      return NextResponse.json(
        { error: "name_too_long", message: `${ACTIVITY_NAME_MAX_LENGTH}文字以内で入力してください。` },
        { status: 400 },
      );
    }

    const existing = await listActivityPresets(userId);
    if (existing.some((preset) => preset.name === name && preset.id !== presetId)) {
      return NextResponse.json(
        { error: "duplicated", message: "同じ名前の項目がすでにあります。" },
        { status: 409 },
      );
    }
  }

  const updated = await updateActivityPreset(userId, presetId, { name });

  if (!updated) {
    return NextResponse.json({ error: "preset_not_found" }, { status: 404 });
  }

  return NextResponse.json({ preset: updated });
}

/**
 * 選択肢を消す。進行中の記録は名前と保存先を写して持っているため、
 * 記録の途中で選択肢を消しても、その記録はそのまま止められる。
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ presetId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { presetId } = await params;
  const deleted = await deleteActivityPreset(userId, presetId);

  if (!deleted) {
    return NextResponse.json({ error: "preset_not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
