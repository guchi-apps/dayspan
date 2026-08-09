import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";

type Body = { googleAccountId?: string };

/**
 * Google Calendar連携を解除する。CalendarSettingはGoogleAccountのカスケード削除で消える。
 * Google側の認可はユーザーのアカウント設定からしか取り消せないため、ここではトークンの破棄のみ行う。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Body;
  if (!body.googleAccountId) {
    return NextResponse.json({ error: "googleAccountId is required" }, { status: 400 });
  }

  const result = await db.googleAccount.deleteMany({
    where: { id: body.googleAccountId, userId },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
