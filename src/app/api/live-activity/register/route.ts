import { NextResponse } from "next/server";

import { isApnsConfigured } from "@/lib/apns/config";
import { isApnsEnvironment } from "@/lib/apns/send";
import { requireUserId } from "@/lib/auth-user";
import {
  isValidLiveActivityToken,
  saveLiveActivityDevice,
} from "@/services/live-activity/devices";

type Body = { token?: string; environment?: string };

/**
 * ライブアクティビティを「始める」ためのトークン（push-to-start）の登録（issue #971）。
 * ログイン済みのWebViewから、アプリが受け取ったトークンを渡して呼ぶ。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!isApnsConfigured()) {
    return NextResponse.json({ error: "apns_not_configured" }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const token = body?.token?.trim();
  if (!token || !isValidLiveActivityToken(token)) {
    return NextResponse.json({ error: "invalid token" }, { status: 400 });
  }
  if (!isApnsEnvironment(body?.environment)) {
    return NextResponse.json({ error: "invalid environment" }, { status: 400 });
  }

  await saveLiveActivityDevice(userId, { token, environment: body.environment });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
