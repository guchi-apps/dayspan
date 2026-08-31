import { NextResponse, type NextRequest } from "next/server";

import { isAllowedEmail } from "@/lib/allowed-users";
import { CALENDAR_VIEW_COOKIE } from "@/lib/calendar-view-memory";
import { db } from "@/lib/db";
import { resolveInternalPath } from "@/lib/home-path";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = getRequestOrigin(request);
  const code = searchParams.get("code");
  const next = resolveInternalPath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const { user } = data;

  // 初期リリースは許可されたユーザーのみ利用可能（docs/spec.md §3）。
  // 許可外のアカウントはDaySpan側のユーザーを作らず、Supabaseのセッションも破棄する。
  if (!isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_allowed`);
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

  const response = NextResponse.redirect(`${origin}${next}`);

  // ログインを求められた＝セッションが途切れた体験。ブラウジングコンテキスト自体は
  // 変わらないため起動判定（resetCalendarMemoryOnLaunch）には掛からず、以前見ていた
  // 月の記憶がそのまま残ってしまう（issue #486）。ログイン成功時も起動時と同様に捨てる。
  response.cookies.delete(CALENDAR_VIEW_COOKIE);

  return response;
}
