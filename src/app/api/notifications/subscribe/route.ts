import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { getRequestOrigin } from "@/lib/request-origin";
import { isPushConfigured } from "@/lib/web-push/keys";
import { deleteSubscription, saveSubscription } from "@/services/notifications/subscriptions";

/**
 * 通知の送信先（端末ごと）の登録・解除（docs/spec.md §32）。
 *
 * 中身はブラウザの `pushManager.subscribe()` が返す値をそのまま受ける。鍵はその端末のために
 * ブラウザが発行したもので、DaySpanの資格情報ではない。
 */

type Body = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 鍵が無い環境では、購読だけ作れても送る手段が無い。登録できたように見せない。
  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: "push_not_configured", message: "サーバーで通知の鍵が設定されていません。" },
      { status: 503 },
    );
  }

  const body = (await request.json()) as Body;
  const endpoint = body.endpoint?.trim();
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "endpoint and keys are required" }, { status: 400 });
  }

  if (!endpoint.startsWith("https://")) {
    return NextResponse.json({ error: "endpoint must be https" }, { status: 400 });
  }

  const subscription = await saveSubscription(userId, {
    endpoint,
    p256dh,
    auth,
    origin: getRequestOrigin(request),
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ subscription }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const endpoint = body?.endpoint?.trim();

  if (!endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }

  const deleted = await deleteSubscription(userId, endpoint);
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
