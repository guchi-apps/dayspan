import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { ACTIVITY_NAME_MAX_LENGTH } from "@/services/activity/presets";
import { ActivityCalendarNotFoundError, startActivity } from "@/services/activity/running";

type Body = {
  /** 選択肢から始める場合。記録する名前は選択肢のものになる。 */
  presetId?: string;
  /** 選択肢に無いことを1回だけ記録する場合。 */
  title?: string;
};

/**
 * 記録を始める（docs/spec.md §27）。
 *
 * すでに記録中なら、そこまでを予定にしてから新しい記録を始める。切り替えのたびに
 * 止める操作を挟ませると、記録が途切れた時間帯ができるため。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Body;

  // 開始時刻はサーバーの時計で決める。端末の時計がずれていると、記録した時間帯そのものが
  // ずれた予定になる。押し忘れの修正は開始時刻を直す経路（PATCH /api/activities/running）で行う。
  // 保存先は項目ごとではなく記録全体で1つのため、ここでは受け取らない（設定から選ぶ）。
  let title = body.title?.trim() ?? "";

  if (body.presetId) {
    const preset = await db.activityPreset.findFirst({
      where: { id: body.presetId, userId },
    });
    if (!preset) {
      return NextResponse.json({ error: "preset_not_found" }, { status: 404 });
    }
    title = preset.name;
  }

  if (!title) {
    return NextResponse.json({ error: "presetId or title is required" }, { status: 400 });
  }
  if (title.length > ACTIVITY_NAME_MAX_LENGTH) {
    return NextResponse.json(
      { error: "title_too_long", message: `${ACTIVITY_NAME_MAX_LENGTH}文字以内で入力してください。` },
      { status: 400 },
    );
  }

  try {
    const result = await startActivity(userId, { title });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ActivityCalendarNotFoundError) {
      return NextResponse.json(
        { error: "calendar_not_found", message: error.message },
        { status: 404 },
      );
    }
    // 切り替えでは、前の記録の書き出し（Googleへの作成）で失敗することがある。
    // どちらの失敗かは理由の文面に出るため、まとめて外部APIの失敗として返す。
    return externalApiError("google", "活動記録の開始", error);
  }
}
