import { externalApiMessage } from "@/lib/api-error";
import { encryptSecret } from "@/lib/crypto/secret-cipher";
import { db } from "@/lib/db";

import { exchangeCodeForTokens, parseIdToken } from "./oauth";

/** 連携の結果。`/settings/google?google=` と、iOSアプリへ返す `result` に使う定型値。 */
export type LinkResult =
  | "connected"
  | "exchange_failed"
  | "no_refresh_token"
  | "no_identity";

/**
 * 認可コードをトークンへ交換し、`userId` のGoogleアカウントとして保存する。
 *
 * ログインCookieの経路（`/api/google/callback`）とiOSのintent経路が同じ処理を通る。
 * スコープ・offline access・暗号化保存の方針はここに1つだけ持つ。
 */
export async function linkGoogleAccount(input: {
  userId: string;
  code: string;
  origin: string;
}): Promise<LinkResult> {
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({ code: input.code, origin: input.origin });
  } catch (error) {
    // リダイレクト先には定型のクエリ値しか渡せないため、理由はログにだけ残す
    // （CLAUDE.md「外部APIの扱い」）。
    externalApiMessage("google", "OAuthトークン交換", error);
    return "exchange_failed";
  }

  // access_type=offline & prompt=consent を付けているので通常は返るが、返らなかった場合は
  // トークン更新ができず連携が成立しないため、保存せずにやり直してもらう。
  if (!tokens.refresh_token) return "no_refresh_token";

  const identity = tokens.id_token ? parseIdToken(tokens.id_token) : null;
  if (!identity) return "no_identity";

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const fields = {
    email: identity.email,
    accessToken: encryptSecret(tokens.access_token),
    accessTokenExpiresAt: expiresAt,
    refreshToken: encryptSecret(tokens.refresh_token),
    scope: tokens.scope,
  };

  await db.googleAccount.upsert({
    where: { userId_googleUserId: { userId: input.userId, googleUserId: identity.sub } },
    create: { userId: input.userId, googleUserId: identity.sub, ...fields },
    update: fields,
  });

  return "connected";
}
