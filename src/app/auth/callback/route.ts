import { NextResponse, type NextRequest } from "next/server";

import { isUserAllowed } from "@/lib/access/client";
import { CALENDAR_VIEW_COOKIE } from "@/lib/calendar-view-memory";
import { encryptSecret } from "@/lib/crypto/secret-cipher";
import { db } from "@/lib/db";
import { resolveInternalPath, safeInternalPath, START_PATH_COOKIE } from "@/lib/home-path";
import { issueHandoff } from "@/lib/native-auth/handoff";
import { nativeLoginCodeUrl, nativeLoginErrorUrl } from "@/lib/native-auth/native-app";
import { handoffStore } from "@/lib/native-auth/stores";
import { isValidChallenge } from "@/lib/native-auth/tokens";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";
import { signOutThisApp } from "@/lib/supabase/sign-out";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = getRequestOrigin(request);
  const code = searchParams.get("code");
  const next = resolveInternalPath(
    searchParams.get("next"),
    request.cookies.get(START_PATH_COOKIE)?.value,
  );

  // iOSアプリの認証シート（issue #908）。戻り先はアプリのスキームで、アプリへ返すのは
  // 一度限りの引き継ぎコードだけ。遷移先（next・起動画面）とカレンダー記憶の破棄は、
  // WKWebViewのCookieが届く /auth/native/consume で行う（このシートはエフェメラルでCookieを持たない）。
  const challenge = searchParams.get("challenge");
  const native = searchParams.get("native") === "1" && isValidChallenge(challenge);

  if (!code) {
    return NextResponse.redirect(
      native ? nativeLoginErrorUrl("auth_failed") : `${origin}/login?error=auth_failed`,
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(
      native ? nativeLoginErrorUrl("auth_failed") : `${origin}/login?error=auth_failed`,
    );
  }

  const { user } = data;

  // 初期リリースは許可されたユーザーのみ利用可能（docs/spec.md §3）。
  // 許可外のアカウントはDaySpan側のユーザーを作らず、Supabaseのセッションも破棄する。
  if (!(await isUserAllowed(user))) {
    await signOutThisApp(supabase);
    return NextResponse.redirect(
      native ? nativeLoginErrorUrl("not_allowed") : `${origin}/login?error=not_allowed`,
    );
  }

  const metadata = user.user_metadata as Record<string, unknown>;

  await db.user.upsert({
    where: { supabaseUserId: user.id },
    create: {
      supabaseUserId: user.id,
      email: user.email ?? null,
      name: (metadata.full_name as string) ?? (metadata.name as string) ?? null,
      image: (metadata.avatar_url as string) ?? null,
      uiSetting: { create: {} },
    },
    update: {
      email: user.email ?? null,
      name: (metadata.full_name as string) ?? (metadata.name as string) ?? null,
      image: (metadata.avatar_url as string) ?? null,
    },
  });

  if (native && challenge) {
    const session = data.session;
    if (!session) {
      return NextResponse.redirect(nativeLoginErrorUrl("auth_failed"));
    }

    const nextParam = searchParams.get("next");
    const handoffCode = await issueHandoff({
      store: handoffStore,
      challenge,
      sessionCipher: encryptSecret(
        JSON.stringify({
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
        }),
      ),
      next: nextParam ? safeInternalPath(nextParam) : null,
      now: new Date(),
    });

    const nativeResponse = NextResponse.redirect(nativeLoginCodeUrl(handoffCode));
    // シートのCookieはシートの終了で捨てられるが、念のためここでも消す。サーバー側の
    // セッションは失効させない（引き継ぎ先のWKWebViewが同じセッションを使うため）。
    for (const { name } of request.cookies.getAll()) {
      if (name.startsWith("sb-")) nativeResponse.cookies.delete(name);
    }
    return nativeResponse;
  }

  const response = NextResponse.redirect(`${origin}${next}`);

  // ログインを求められた＝セッションが途切れた体験。ブラウジングコンテキスト自体は
  // 変わらないため起動判定（resetCalendarMemoryOnLaunch）には掛からず、以前見ていた
  // 月の記憶がそのまま残ってしまう（issue #486）。ログイン成功時も起動時と同様に捨てる。
  response.cookies.delete(CALENDAR_VIEW_COOKIE);

  return response;
}
