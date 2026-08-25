import { NextResponse, after } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { notifyActivityStarted } from "@/services/notifications/activity";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { ACTIVITY_NAME_MAX_LENGTH } from "@/services/activity/presets";
import {
  ActivityCalendarNotFoundError,
  ActivityTimeRangeError,
  startActivity,
} from "@/services/activity/running";

type Body = {
  /** 選択肢から始める場合。記録する名前は選択肢のものになる。 */
  presetId?: string;
  /** 選択肢に無いことを1回だけ記録する場合。 */
  title?: string;
  /** 開始時刻（ISO 8601）。押し忘れて後から始めるとき以外は送らない。 */
  startedAt?: string;
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

  // 開始時刻は既定ではサーバーの時計で決める。端末の時計がずれていると、記録した時間帯
  // そのものがずれた予定になるため。押し忘れて後から始めるときだけ startedAt を受け、
  // それでも未来は受けない（サービス側の resolveRecordTime）。
  // 保存先は項目ごとではなく記録全体で1つのため、ここでは受け取らない（設定から選ぶ）。
  let title = body.title?.trim() ?? "";

  const startedAt = body.startedAt ? new Date(body.startedAt) : undefined;
  if (startedAt && Number.isNaN(startedAt.getTime())) {
    return NextResponse.json({ error: "startedAt is invalid" }, { status: 400 });
  }

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
    const result = await startActivity(userId, { title, startedAt });

    // 記録中であることを通知として残す（docs/spec.md §32）。応答を待たせないのは、
    // 送信先のプッシュサーバーへの往復が、押してから画面が変わるまでの時間になるため。
    after(async () => {
      try {
        await notifyActivityStarted(userId, {
          title: result.running.title,
          startedAt: new Date(result.running.startedAt),
        });
      } catch (error) {
        console.error("[dayspan] activity notification failed:", error);
      }
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ActivityTimeRangeError) {
      return NextResponse.json({ error: "invalid_time", message: error.message }, { status: 400 });
    }
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
