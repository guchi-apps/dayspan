import { NextResponse } from "next/server";

import { isApnsConfigured } from "@/lib/apns/config";
import { isApnsEnvironment } from "@/lib/apns/send";
import { requireUserId } from "@/lib/auth-user";
import {
  deleteApnsDevice,
  isValidApnsToken,
  saveApnsDevice,
} from "@/services/notifications/apns-devices";

/**
 * iOSアプリの通知の送信先（APNsのデバイストークン）の登録・解除（docs/spec.md §32）。
 *
 * ログイン済みのWebViewから、アプリが受け取ったトークンを渡して呼ぶ。トークンはその端末・
 * そのアプリのためにAppleが発行した値で、DaySpanの資格情報ではない。
 */

type Body = {
  token?: string;
  environment?: string;
};

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 認証キーが無い環境では、登録だけ作れても送る手段が無い。登録できたように見せない。
  if (!isApnsConfigured()) {
    return NextResponse.json(
      { error: "apns_not_configured", message: "サーバーでAPNsの認証キーが設定されていません。" },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const token = body?.token?.trim();

  if (!token || !isValidApnsToken(token)) {
    return NextResponse.json({ error: "invalid token" }, { status: 400 });
  }
  if (!isApnsEnvironment(body?.environment)) {
    return NextResponse.json({ error: "invalid environment" }, { status: 400 });
  }

  await saveApnsDevice(userId, {
    token,
    environment: body.environment,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const token = body?.token?.trim();
  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  const deleted = await deleteApnsDevice(userId, token);
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
