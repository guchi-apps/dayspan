import { NextResponse, type NextRequest } from "next/server";

import { isAllowedEmail } from "@/lib/allowed-users";
import { db } from "@/lib/db";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = getRequestOrigin(request);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/calendar";

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

  return NextResponse.redirect(`${origin}${next}`);
}
