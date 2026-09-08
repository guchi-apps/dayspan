import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { ACTIVITY_NAME_MAX_LENGTH } from "@/services/activity/presets";
import { setSleepSettings } from "@/services/activity/settings";

type Body = { title?: unknown; targetMinutes?: unknown };

/**
 * 睡眠の横通し表示の設定を変える（docs/spec.md §39）。
 *
 * 保存先カレンダー（/api/activities/settings）とは別の入口にする。あちらは「未指定は
 * 送り忘れとして断る」形で、送られた項目だけを直すこの経路と受け取り方が逆になるため。
 */
export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Body;

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length === 0) {
      return NextResponse.json(
        { error: "invalid_title", message: "睡眠として数える項目名を入力してください。" },
        { status: 400 },
      );
    }
    if (body.title.trim().length > ACTIVITY_NAME_MAX_LENGTH) {
      return NextResponse.json(
        {
          error: "invalid_title",
          message: `項目名は${ACTIVITY_NAME_MAX_LENGTH}文字までです。`,
        },
        { status: 400 },
      );
    }
  }

  if (body.targetMinutes !== undefined && !Number.isInteger(body.targetMinutes)) {
    return NextResponse.json(
      { error: "invalid_target", message: "目標睡眠時間を分の整数で送ってください。" },
      { status: 400 },
    );
  }

  // 幅の丸め（1時間〜16時間）はサービス層に置いてある。画面で止めるだけにすると、
  // DaySpanのAPIや将来のMCPから直接呼ばれた要求が素通りする。
  const settings = await setSleepSettings(userId, {
    title: body.title as string | undefined,
    targetMinutes: body.targetMinutes as number | undefined,
  });

  return NextResponse.json(settings);
}
