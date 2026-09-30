import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { issueIntent } from "@/lib/native-auth/google-intent";
import { intentStore } from "@/lib/native-auth/stores";

/**
 * iOSアプリからのGoogle Calendar連携の開始intentを発行する（issue #908）。
 *
 * ログイン済みのWKWebViewから呼ぶ。返したURLを認証シート（Cookieなし）で開くと、
 * このユーザーのGoogleアカウントとして連携される。intentは60秒・一度限り。
 */
export async function POST() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = await issueIntent({ store: intentStore, userId, now: new Date() });

  return NextResponse.json({ url: `/api/google/connect?intent=${encodeURIComponent(token)}` });
}
