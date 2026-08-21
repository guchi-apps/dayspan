import { NextResponse, type NextRequest } from "next/server";

import { resolveInternalPath } from "@/lib/home-path";
import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

/**
 * Googleログインを開始する。
 *
 * ログインはクライアントJSのハイドレーションが完了していなくても動く必要があるため、
 * ブラウザ側でsignInWithOAuthを呼ばず、サーバーで認可URLを組み立ててリダイレクトする。
 * PKCEの検証値はSupabaseのサーバークライアントがCookieへ書き、/auth/callback が読む。
 */
export async function GET(request: NextRequest) {
  const origin = getRequestOrigin(request);
  const next = resolveInternalPath(request.nextUrl.searchParams.get("next"));

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      // ここではリダイレクトせずURLだけ受け取り、こちらで302を返す。
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    console.error("[dayspan] googleログインの開始に失敗:", error?.message ?? "URLが返らなかった");
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  return NextResponse.redirect(data.url);
}
