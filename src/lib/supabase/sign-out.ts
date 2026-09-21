/**
 * このアプリのセッションだけを破棄する。
 *
 * SupabaseのプロジェクトはほかのアプリともユーザーとJWT署名鍵を共有している。`signOut()` を
 * 引数なしで呼ぶと既定の scope が `global` になり、同じユーザーの他アプリ・他端末の
 * refresh token まで失効して、ログアウトしただけで他のアプリのログインが切れる（issue #676）。
 * ここでは必ず `local` を渡し、この端末のこのブラウザが持つセッションだけを終わらせる。
 *
 * `supabase.auth.signOut()` を直接書かず、この関数を通す。呼び出しを1か所に閉じておけば、
 * scope を渡すこと自体を回帰テストで確かめられる（`sign-out.test.mts`）。
 *
 * 型を `SupabaseClient` にしないのは、テストが `@supabase/supabase-js` を実行時に読まずに
 * 済むようにするため（`@/` のimport経路を軽く保つ・CLAUDE.md「自動テスト」）。
 */
export type SignOutClient = {
  auth: {
    signOut(options: { scope: "local" }): Promise<{ error: { message: string } | null }>;
  };
};

export function signOutThisApp(supabase: SignOutClient) {
  return supabase.auth.signOut({ scope: "local" });
}
