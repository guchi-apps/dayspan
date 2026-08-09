import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { getRequestOrigin } from "@/lib/request-origin";
import { buildAuthUrl } from "@/services/google-calendar/oauth";

export const OAUTH_STATE_COOKIE = "dayspan_google_oauth_state";

export async function GET(request: NextRequest) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const origin = getRequestOrigin(request);
  // CSRF対策。認可リクエストに載せたstateと、コールバックで戻ってきたstateが一致することを
  // Cookie経由で確認する。
  const state = randomBytes(32).toString("base64url");

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
