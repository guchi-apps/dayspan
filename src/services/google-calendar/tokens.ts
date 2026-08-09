import type { GoogleAccount } from "@prisma/client";

import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-cipher";
import { db } from "@/lib/db";

import { refreshAccessToken } from "./oauth";

// 期限ぎりぎりのトークンでAPIを叩くと、通信中に期限切れになることがある。
// 余裕を持って更新する。
const EXPIRY_MARGIN_MS = 60 * 1000;

export class GoogleReauthRequiredError extends Error {
  constructor(message = "Google Calendarの再接続が必要です") {
    super(message);
    this.name = "GoogleReauthRequiredError";
  }
}

/**
 * 有効なアクセストークンを返す。期限切れ（または期限間近）ならリフレッシュしてDBを更新する。
 * リフレッシュトークンが失効している場合は再接続が必要なため、専用のエラーで通知する。
 */
export async function getValidAccessToken(account: GoogleAccount): Promise<string> {
  const isUsable =
    account.accessToken &&
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now();

  if (isUsable) {
    return decryptSecret(account.accessToken!);
  }

  let tokens;
  try {
    tokens = await refreshAccessToken(decryptSecret(account.refreshToken));
  } catch (error) {
    // Googleのテストユーザー向けリフレッシュトークンは7日で失効する。失効時はユーザーに
    // 再接続してもらうしかないため、握りつぶさず呼び出し側へ伝える。
    throw new GoogleReauthRequiredError(
      error instanceof Error ? error.message : "リフレッシュに失敗しました",
    );
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await db.googleAccount.update({
    where: { id: account.id },
    data: {
      accessToken: encryptSecret(tokens.access_token),
      accessTokenExpiresAt: expiresAt,
      // Googleはリフレッシュ時に refresh_token を返さないことがある。返ったときだけ差し替える。
      ...(tokens.refresh_token ? { refreshToken: encryptSecret(tokens.refresh_token) } : {}),
      scope: tokens.scope,
    },
  });

  return tokens.access_token;
}
