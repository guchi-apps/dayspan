import { createPrivateKey, type KeyObject } from "node:crypto";

/**
 * APNs（Apple Push Notification service）の認証設定（docs/notifications.md）。
 *
 * 認証キー（.p8）はApple Developerで発行する、P-256の秘密鍵（PKCS#8のPEM）。環境変数へ入れるときは
 * PEMの改行が `\n` の文字列になることがあるため、改行を復元して読む。PEMの代わりにbase64でも受ける
 * （VAPID鍵を1行で持つ理由と同じで、改行を含む値をシークレットへ通す事故を避けるため）。
 *
 * このファイルは他のモジュールを読み込まない（node --test から直接読めるようにするため）。
 */

export type ApnsConfig = {
  keyId: string;
  teamId: string;
  privateKey: KeyObject;
  /** `apns-topic`。アプリのBundle ID。 */
  topic: string;
};

export class ApnsConfigError extends Error {}

/** Bundle IDの既定。`ios/YoteiFlow.xcodeproj` の PRODUCT_BUNDLE_IDENTIFIER と揃える。 */
export const DEFAULT_APNS_TOPIC = "com.gucchii.yoteiflow";

/** 設定されているか。未設定ならAPNsへの送信は行わない（Web Pushだけで動く）。 */
export function isApnsConfigured(): boolean {
  return Boolean(
    process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && process.env.APNS_PRIVATE_KEY,
  );
}

/** 環境変数の値から秘密鍵（PEM）を取り出す。PEM（改行は `\n` の文字列でも可）かbase64を受ける。 */
export function normalizeApnsPrivateKey(raw: string): string {
  const trimmed = raw.trim().replace(/\\n/g, "\n");
  if (trimmed.includes("BEGIN")) return trimmed;
  return Buffer.from(trimmed, "base64").toString("utf8").trim();
}

let cached: ApnsConfig | null = null;

export function getApnsConfig(): ApnsConfig {
  if (cached) return cached;

  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const rawKey = process.env.APNS_PRIVATE_KEY;

  if (!keyId || !teamId || !rawKey) {
    throw new ApnsConfigError("APNS_KEY_ID / APNS_TEAM_ID / APNS_PRIVATE_KEY が設定されていません。");
  }

  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(normalizeApnsPrivateKey(rawKey));
  } catch {
    throw new ApnsConfigError("APNS_PRIVATE_KEY が秘密鍵（.p8）として読めません。");
  }

  if (privateKey.asymmetricKeyType !== "ec") {
    throw new ApnsConfigError("APNS_PRIVATE_KEY がEC（P-256）の鍵ではありません。");
  }

  cached = {
    keyId,
    teamId,
    privateKey,
    topic: process.env.APNS_BUNDLE_ID?.trim() || DEFAULT_APNS_TOPIC,
  };
  return cached;
}
