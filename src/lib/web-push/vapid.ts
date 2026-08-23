import { sign, type KeyObject } from "node:crypto";

/**
 * VAPIDの署名（RFC 8292）。
 *
 * 送信先のプッシュサーバーへ「この購読を作らせたサーバーからの送信である」ことを示す。
 * 署名の鍵は購読のときにブラウザへ渡した公開鍵と対になっている必要がある。
 *
 * このファイルは他のモジュールを読み込まない。検証（scripts/check-web-push.mjs）が
 * Next.jsのパス別名を解決せずに直接読み込めるようにするため。
 */

/** 署名の有効期間。24時間を超える値を拒む送信先があるため、それより短くする。 */
const JWT_TTL_SECONDS = 12 * 60 * 60;

export type VapidSigningKeys = {
  /** base64url（65バイトの非圧縮点）。ヘッダーの k= にそのまま入る。 */
  publicKey: string;
  privateKey: KeyObject;
  subject: string;
};

/**
 * `Authorization: vapid t=<JWT>, k=<公開鍵>`（RFC 8292 §3）。
 *
 * JWTの宛先（aud）は送信先のオリジン。パスまで入れると拒む送信先がある。
 */
export function buildVapidAuthorization(
  endpoint: string,
  keys: VapidSigningKeys,
  now: Date = new Date(),
): string {
  const audience = new URL(endpoint).origin;

  const header = base64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = base64url(
    JSON.stringify({
      aud: audience,
      exp: Math.floor(now.getTime() / 1000) + JWT_TTL_SECONDS,
      sub: keys.subject,
    }),
  );

  const signingInput = `${header}.${claims}`;

  // ES256の署名は r と s を連結した64バイト。Nodeの既定はDER形式で、そのままでは検証側が読めない。
  const signature = sign("sha256", Buffer.from(signingInput), {
    key: keys.privateKey,
    dsaEncoding: "ieee-p1363",
  });

  return `vapid t=${signingInput}.${signature.toString("base64url")}, k=${keys.publicKey}`;
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
