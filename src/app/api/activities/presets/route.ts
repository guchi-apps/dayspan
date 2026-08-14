import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import {
  ACTIVITY_NAME_MAX_LENGTH,
  createActivityPreset,
  listActivityPresets,
  reorderActivityPresets,
} from "@/services/activity/presets";

type CreateBody = { name?: string; calendarId?: string | null };
type ReorderBody = { ids?: string[] };

/** 記録の選択肢を1つ足す（docs/spec.md §27）。 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as CreateBody;
  const name = body.name?.trim() ?? "";

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (name.length > ACTIVITY_NAME_MAX_LENGTH) {
    return NextResponse.json(
      { error: "name_too_long", message: `${ACTIVITY_NAME_MAX_LENGTH}文字以内で入力してください。` },
      { status: 400 },
    );
  }

  // 同じ名前を2つ並べても、押したときにどちらが選ばれたのか区別できない（一意制約と同じ判断）。
  const existing = await listActivityPresets(userId);
  if (existing.some((preset) => preset.name === name)) {
    return NextResponse.json(
      { error: "duplicated", message: "同じ名前の項目がすでにあります。" },
      { status: 409 },
    );
  }

  const created = await createActivityPreset(userId, { name, calendarId: body.calendarId ?? null });
  return NextResponse.json({ preset: created });
}

/**
 * 並び順をまとめて保存する。
 * 1つずつ入れ替えると、途中で失敗したときに同じ順位の行が残るため、全件の並びで受ける。
 */
export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { ids } = (await request.json()) as ReorderBody;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "ids is required" }, { status: 400 });
  }

  const ok = await reorderActivityPresets(userId, ids);
  if (!ok) {
    return NextResponse.json({ error: "ids_mismatch" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
