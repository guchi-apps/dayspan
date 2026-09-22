import { NextResponse } from "next/server";

import { calendarWriteError, externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { confirmEvent } from "@/services/google-calendar/events";
import { resolveGoogleAccountForCalendar } from "@/services/calendar/write-context";

/**
 * 仮の予定を確定する（issue #688）。表示画面の「仮の予定を確定する」ボタン専用。
 *
 * フルの `PATCH /api/events/[eventId]` を経由させないのは、確定操作ではタイトル・日時など
 * 他の項目を毎回送らせる理由が無いため（Googleの status フィールドだけを変える）。
 * 削除と違って確認は挟まない。戻したければ編集フォームで「仮の予定」を選び直せる。
 */

type Body = { calendarId?: string };

export async function POST(
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

  const target = await resolveGoogleAccountForCalendar(userId, body.calendarId);
  if (!target.ok) {
    return calendarWriteError(target.reason);
  }

  try {
    await confirmEvent(target.account, body.calendarId, eventId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return externalApiError("google", "仮の予定の確定", error);
  }
}
