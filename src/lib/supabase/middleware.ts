import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_USER_ID_HEADER } from "@/lib/auth-header";
import { getRequestOrigin } from "@/lib/request-origin";

const publicPaths = ["/login", "/auth/signin", "/auth/callback"];

function isPublicPath(pathname: string): boolean {
  return publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function updateSession(request: NextRequest) {
  // セッション更新でSupabaseが発行したCookieは、最終的に返すレスポンスへ必ず載せる必要がある。
  // 素通しとリダイレクトのどちらを返すかはユーザーの有無を見てからでないと決まらないため、
  // ここではいったん溜めておき、レスポンスを組み立てる時点でまとめて付ける。
  const refreshedCookies: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          refreshedCookies.push(...cookiesToSet);
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 検証済みのユーザーIDを後段へ渡し、ページ側が同じ検証を繰り返さずに済むようにする。
  // auth.getUser()は毎回Supabaseへ往復するため、1リクエストで2回叩くと待ち時間がそのまま倍になる。
  // 詐称を防ぐため、未ログインのときは値を残さず消す。
  const requestHeaders = new Headers(request.headers);
  if (user) {
    requestHeaders.set(SUPABASE_USER_ID_HEADER, user.id);
  } else {
    requestHeaders.delete(SUPABASE_USER_ID_HEADER);
  }

  function withRefreshedCookies<T extends NextResponse>(response: T): T {
    refreshedCookies.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options),
    );
    return response;
  }

  const proceed = () =>
    withRefreshedCookies(NextResponse.next({ request: { headers: requestHeaders } }));

  const { pathname } = request.nextUrl;

  // /api/* はルートハンドラ自身が requireUserId() で認証チェックし、
  // 401 JSON を返す設計のため、ここではリダイレクトせず素通りさせる。
  if (pathname.startsWith("/api/")) {
    return proceed();
  }

  // ログイン済みユーザーが /login を開いた場合（ブラウザの「戻る」操作等）は
  // ログイン画面を再表示せずカレンダーへ送る。
  if (pathname === "/login" && user) {
    const callbackUrl = request.nextUrl.searchParams.get("callbackUrl");
    const target =
      callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
        ? callbackUrl
        : "/calendar";
    return withRefreshedCookies(NextResponse.redirect(new URL(target, getRequestOrigin(request))));
  }

  if (isPublicPath(pathname)) {
    return proceed();
  }

  if (!user) {
    const loginUrl = new URL("/login", getRequestOrigin(request));
    loginUrl.searchParams.set("callbackUrl", pathname);
    return withRefreshedCookies(NextResponse.redirect(loginUrl));
  }

  return proceed();
}
