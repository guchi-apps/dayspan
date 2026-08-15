import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { setActivityCalendarId } from "@/services/activity/settings";

type Body = { calendarId?: string | null };

/**
 * 活動記録の保存先カレンダーを変える（docs/spec.md §27）。
 *
 * 保存先は項目ごとではなく記録全体で1つ。null は「予定作成の既定の保存先へ入れる」を表す。
 * 表示設定（/api/settings/ui）ではなくここに置いているのは、指定されたカレンダーが
 * そのユーザーのものかを確かめる必要があり、その判断が活動記録側にあるため。
 */
export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Body;

  // 「既定の保存先へ戻す」は null で表す。未指定（undefined）は何も変えないのではなく、
  // 送り忘れとして断る（黙って既定へ戻すと、選んだ保存先が消えたように見える）。
  if (body.calendarId === undefined) {
    return NextResponse.json({ error: "calendarId is required" }, { status: 400 });
  }
  if (body.calendarId !== null && typeof body.calendarId !== "string") {
    return NextResponse.json({ error: "calendarId must be a string or null" }, { status: 400 });
  }

  const result = await setActivityCalendarId(userId, body.calendarId);
  if (!result.ok) {
    return NextResponse.json(
      { error: "calendar_not_found", message: "選択したカレンダーが見つかりません。" },
      { status: 404 },
    );
  }

  return NextResponse.json({ calendarId: result.calendarId });
}
