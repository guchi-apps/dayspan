import { headers } from "next/headers";

import { isAllowedEmail } from "@/lib/allowed-users";
import { SUPABASE_USER_ID_HEADER } from "@/lib/auth-header";
import { db } from "@/lib/db";

/**
 * ログイン中のユーザーを返す。
 *
 * Supabaseのセッション検証は proxy.ts が済ませ、結果をヘッダーで渡してくる。ここで
 * auth.getUser() を呼び直すと、1リクエストにつきSupabaseへの往復が2回入ってしまう。
 * proxy.ts のmatcherが外れているパス（静的アセット等）からは呼べないことに注意する。
 *
 * 許可リスト（ALLOWED_GOOGLE_EMAILS）から外れたメールアドレスは、DBに`User`行が残り
 * ヘッダーが来ていてもnullを返す。許可判定は `/auth/callback` でDaySpanのユーザーを
 * 作るときに1回だけ行われており、Supabaseのセッションはrefresh tokenで延長され続けるため、
 * ここで確かめないと許可リストから外した後もそのユーザーが使い続けられてしまう（issue #842）。
 * proxy.ts（`updateSession`）も同じ判定を先に行っているが（`/login`からの跳ね返り先の
 * 無限リダイレクトを避けるため）、matcherが外れた経路からの呼び出しにもここで効かせる。
 */
export async function getCurrentUser() {
  const supabaseUserId = (await headers()).get(SUPABASE_USER_ID_HEADER);
  if (!supabaseUserId) return null;

  const user = await db.user.findUnique({ where: { supabaseUserId } });
  if (!user || !isAllowedEmail(user.email)) return null;

  return user;
}

export async function requireUserId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.id ?? null;
}
