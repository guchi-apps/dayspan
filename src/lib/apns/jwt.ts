import { sign, type KeyObject } from "node:crypto";

/**
 * APNsのプロバイダー認証トークン（JWT・ES256）。
 *
 * Appleは同じトークンを20分〜60分の間で使い回すことを求める（頻繁に作り直すと
 * TooManyProviderTokenUpdates で拒まれ、1時間を超えると ExpiredProviderToken になる）。
 * そのため呼び出し側で50分ほど使い回す。
 *
 * このファイルは他のモジュールを読み込まない。
 */

export type ApnsSigningKeys = {
  keyId: string;
  teamId: string;
  privateKey: KeyObject;
};

export function buildApnsJwt(keys: ApnsSigningKeys, now: Date = new Date()): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keys.keyId }));
  const claims = base64url(
    JSON.stringify({ iss: keys.teamId, iat: Math.floor(now.getTime() / 1000) }),
  );
  const signingInput = `${header}.${claims}`;

  // ES256は r と s を連結した64バイト。Nodeの既定のDER形式のままではAppleが読めない。
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: keys.privateKey,
    dsaEncoding: "ieee-p1363",
  });

  return `${signingInput}.${signature.toString("base64url")}`;
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
