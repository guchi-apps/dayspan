import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { setHolidayCalendarId } from "@/services/calendar/holiday-settings";

type Body = { calendarId?: string | null };

/**
 * 祝日として扱うカレンダーを変える（issue #699）。
 *
 * null は「祝日の優先表示なし」を表す。表示設定（/api/settings/ui）ではなくここに
 * 置いているのは、指定されたカレンダーがそのユーザーのものかを確かめる必要があり、
 * その判断が祝日カレンダー側にあるため（/api/activities/settings と同じ理由）。
 */
export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Body;

  // 未指定（undefined）は送り忘れとして断る（黙って「なし」に戻すと、選んだ
  // カレンダーが消えたように見える）。
  if (body.calendarId === undefined) {
    return NextResponse.json({ error: "calendarId is required" }, { status: 400 });
  }
  if (body.calendarId !== null && typeof body.calendarId !== "string") {
    return NextResponse.json({ error: "calendarId must be a string or null" }, { status: 400 });
  }

  const result = await setHolidayCalendarId(userId, body.calendarId);
  if (!result.ok) {
    return NextResponse.json(
      { error: "calendar_not_found", message: "選択したカレンダーが見つかりません。" },
      { status: 404 },
    );
  }

  return NextResponse.json({ calendarId: result.calendarId });
}
