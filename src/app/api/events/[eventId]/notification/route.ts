import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import {
  clearEventNotificationSetting,
  EventNotificationSettingsError,
  setEventNotificationSetting,
  toEventNotificationOverride,
} from "@/services/calendar/event-notification-settings";

/**
 * 予定ごとの通知設定（issue #708）。
 *
 * `resolveGoogleAccountForCalendar()` は通さない。設定はGoogleへ書き込まないため、
 * 「使用」がオフのカレンダーの予定にも付けられてよい（中止・不参加の記録と同じ判断）。
 */

type Body = {
  calendarId?: string;
  enabled?: boolean;
  leadMinutes?: number[];
};

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { eventId } = await params;
  const body = (await request.json()) as Body;

  if (!body.calendarId) {
    return NextResponse.json(
      { error: "invalid_request", message: "calendarId は必須です。" },
      { status: 400 },
    );
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "invalid_request", message: "通知するかどうかを指定してください。" },
      { status: 400 },
    );
  }

  const leadMinutes = Array.isArray(body.leadMinutes)
    ? body.leadMinutes.filter((value): value is number => typeof value === "number")
    : [];

  try {
    const setting = await setEventNotificationSetting(userId, {
      calendarId: body.calendarId,
      eventId,
      enabled: body.enabled,
      leadMinutes,
    });

    return NextResponse.json({ ok: true, notification: toEventNotificationOverride(setting) });
  } catch (error) {
    if (error instanceof EventNotificationSettingsError) {
      return NextResponse.json({ error: "invalid_request", message: error.message }, { status: 400 });
    }
    throw error;
  }
}

/** 上書きを外す。アカウント既定に従う状態へ戻る。 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { eventId } = await params;
  await clearEventNotificationSetting(userId, eventId);

  return NextResponse.json({ ok: true });
}
