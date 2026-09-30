import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { isAllowedEmail } from "@/lib/allowed-users";
import { CALENDAR_VIEW_COOKIE } from "@/lib/calendar-view-memory";
import { decryptSecret } from "@/lib/crypto/secret-cipher";
import { resolveInternalPath, START_PATH_COOKIE } from "@/lib/home-path";
import { consumeHandoff } from "@/lib/native-auth/handoff";
import { handoffStore } from "@/lib/native-auth/stores";
import { isValidVerifier } from "@/lib/native-auth/tokens";
import { createClient } from "@/lib/supabase/server";
import { signOutThisApp } from "@/lib/supabase/sign-out";

/**
 * 引き継ぎコードを消費して、WKWebViewへ通常のSupabase SSR Cookieを渡す（issue #908）。
 *
 * WKWebViewの中から `fetch`（同一オリジン・POST）で呼ぶ。コードとcode_verifierはURLではなく
 * 本文で受けるため、アクセスログに残らない。失敗の理由は区別せず同じ応答にする。
 */
export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const code = typeof (body as { code?: unknown })?.code === "string" ? (body as { code: string }).code : "";
  const verifier = (body as { verifier?: unknown })?.verifier;

  const rejected = () => NextResponse.json({ error: "invalid_handoff" }, { status: 400 });

  if (!code || !isValidVerifier(verifier)) return rejected();

  const handoff = await consumeHandoff({
    store: handoffStore,
    code,
    verifier,
    now: new Date(),
  });
  if (!handoff) return rejected();

  let tokens: { accessToken: string; refreshToken: string };
  try {
    tokens = JSON.parse(decryptSecret(handoff.sessionCipher));
  } catch {
    return rejected();
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  if (error || !data.user) return rejected();

  // 発行後に許可リストから外れた場合に備え、ここでも確かめる。
  if (!isAllowedEmail(data.user.email)) {
    await signOutThisApp(supabase);
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  const cookieStore = await cookies();
  // ログインを求められた体験の後は、以前見ていた月の記憶を捨てる（issue #486・/auth/callback と同じ）。
  cookieStore.delete(CALENDAR_VIEW_COOKIE);

  const next = resolveInternalPath(handoff.next, cookieStore.get(START_PATH_COOKIE)?.value);
  return NextResponse.json({ next });
}
