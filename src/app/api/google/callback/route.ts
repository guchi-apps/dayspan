import { NextResponse, type NextRequest } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { completeIntent } from "@/lib/native-auth/google-intent";
import { nativeGoogleResultUrl } from "@/lib/native-auth/native-app";
import { intentStore } from "@/lib/native-auth/stores";
import { getRequestOrigin } from "@/lib/request-origin";
import { linkGoogleAccount } from "@/services/google-calendar/link-account";

import { OAUTH_STATE_COOKIE } from "../connect/route";

function settingsRedirect(origin: string, result: string) {
  return NextResponse.redirect(`${origin}/settings/google?google=${result}`);
}

export async function GET(request: NextRequest) {
  const origin = getRequestOrigin(request);

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  // iOSアプリの認証シート（issue #908）。ログインCookieの有無ではなく、stateがintent由来かで
  // 先に分ける。SafariのCookieが共有されてログイン済みに見えても、シートはアプリへ戻す必要がある。
  const intent = await completeIntent({
    store: intentStore,
    state,
    cookieState: expectedState ?? null,
    now: new Date(),
  });

  if (intent.kind === "rejected") {
    return NextResponse.redirect(nativeGoogleResultUrl("state_mismatch"));
  }

  if (intent.kind === "ok") {
    // ユーザーはintentからしか取らない。同意画面でキャンセルされた場合もここへ来る。
    const nativeResult =
      searchParams.get("error") || !code
        ? "cancelled"
        : await linkGoogleAccount({ userId: intent.userId, code, origin });

    const response = NextResponse.redirect(nativeGoogleResultUrl(nativeResult));
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  }

  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // ユーザーが同意画面でキャンセルした場合も error 付きで戻ってくる。
  if (searchParams.get("error") || !code) {
    return settingsRedirect(origin, "cancelled");
  }

  if (!state || !expectedState || state !== expectedState) {
    return settingsRedirect(origin, "state_mismatch");
  }

  const result = await linkGoogleAccount({ userId, code, origin });

  const response = settingsRedirect(origin, result);
  if (result === "connected") response.cookies.delete(OAUTH_STATE_COOKIE);

  return response;
}
