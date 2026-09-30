/**
 * 未ログインでも通す画面・経路。`middleware.ts` から切り出しているのは、依存を持たない形にして
 * `node --test` で確かめられるようにするため（`@supabase/ssr` などを実行時に読み込まない）。
 *
 * `/auth/native` はiOSアプリの認証引き継ぎ（issue #908）。`start` は認証シート（Cookieなし）、
 * `consume` はまだログインしていないWKWebViewから呼ばれるため、公開でなければ `/login` へ
 * 飛ばされてネイティブのログインが始まらない。
 */
export const PUBLIC_PATHS = ["/login", "/auth/signin", "/auth/callback", "/auth/native"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
