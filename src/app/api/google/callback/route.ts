import { NextResponse, type NextRequest } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { encryptSecret } from "@/lib/crypto/secret-cipher";
import { db } from "@/lib/db";
import { getRequestOrigin } from "@/lib/request-origin";
import { exchangeCodeForTokens, parseIdToken } from "@/services/google-calendar/oauth";

import { OAUTH_STATE_COOKIE } from "../connect/route";

function settingsRedirect(origin: string, result: string) {
  return NextResponse.redirect(`${origin}/settings/google?google=${result}`);
}

export async function GET(request: NextRequest) {
  const origin = getRequestOrigin(request);

  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  // ユーザーが同意画面でキャンセルした場合も error 付きで戻ってくる。
  if (searchParams.get("error") || !code) {
    return settingsRedirect(origin, "cancelled");
  }

  if (!state || !expectedState || state !== expectedState) {
    return settingsRedirect(origin, "state_mismatch");
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens({ code, origin });
  } catch {
    return settingsRedirect(origin, "exchange_failed");
  }

  // access_type=offline & prompt=consent を付けているので通常は返るが、返らなかった場合は
  // トークン更新ができず連携が成立しないため、保存せずにやり直してもらう。
  if (!tokens.refresh_token) {
    return settingsRedirect(origin, "no_refresh_token");
  }

  const identity = tokens.id_token ? parseIdToken(tokens.id_token) : null;
  if (!identity) {
    return settingsRedirect(origin, "no_identity");
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await db.googleAccount.upsert({
    where: {
      userId_googleUserId: { userId, googleUserId: identity.sub },
    },
    create: {
      userId,
      googleUserId: identity.sub,
      email: identity.email,
      accessToken: encryptSecret(tokens.access_token),
      accessTokenExpiresAt: expiresAt,
      refreshToken: encryptSecret(tokens.refresh_token),
      scope: tokens.scope,
    },
    update: {
      email: identity.email,
      accessToken: encryptSecret(tokens.access_token),
      accessTokenExpiresAt: expiresAt,
      refreshToken: encryptSecret(tokens.refresh_token),
      scope: tokens.scope,
    },
  });

  const response = settingsRedirect(origin, "connected");
  response.cookies.delete(OAUTH_STATE_COOKIE);

  return response;
}
