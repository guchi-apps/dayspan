import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { startIntent } from "@/lib/native-auth/google-intent";
import { nativeGoogleResultUrl } from "@/lib/native-auth/native-app";
import { intentStore } from "@/lib/native-auth/stores";
import { getRequestOrigin } from "@/lib/request-origin";
import { buildAuthUrl } from "@/services/google-calendar/oauth";

export const OAUTH_STATE_COOKIE = "dayspan_google_oauth_state";

function redirectToGoogle(origin: string, state: string) {
  const response = NextResponse.redirect(buildAuthUrl({ origin, state }));

  response.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 600,
  });

  return response;
}

export async function GET(request: NextRequest) {
  const origin = getRequestOrigin(request);

  // iOSアプリの認証シート（issue #908）。ログインCookieを持たないため、ログイン済みのWKWebViewが
  // 発行したintentで対象ユーザーを決める。クエリのトークンはアクセスログに残るので、ここで使い捨てる。
  const intentToken = request.nextUrl.searchParams.get("intent");
  if (intentToken) {
    const started = await startIntent({
      store: intentStore,
      token: intentToken,
      now: new Date(),
    });
    if (!started) {
      return NextResponse.redirect(nativeGoogleResultUrl("intent_invalid"));
    }
    return redirectToGoogle(origin, started.state);
  }

  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // CSRF対策。認可リクエストに載せたstateと、コールバックで戻ってきたstateが一致することを
  // Cookie経由で確認する。
  const state = randomBytes(32).toString("base64url");

  return redirectToGoogle(origin, state);
}
