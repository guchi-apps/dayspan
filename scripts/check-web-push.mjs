#!/usr/bin/env node
/**
 * 通知の送信に使う暗号化と署名が正しいかを確かめる（docs/notifications.md）。
 *
 * 実行:
 *   node --experimental-strip-types scripts/check-web-push.mjs
 *
 * ブラウザも端末も要らない。RFC 8291 §5 に載っている「鍵・salt・平文・出来上がりのボディ」を
 * そのまま通し、1バイトでも違えば落ちる。実機で通知が出ないときに、送信の中身を疑うか
 * 端末側の設定を疑うかを、ここで切り分けられる。
 *
 * VAPIDの署名（RFC 8292）は、その場で作った鍵で署名して同じ鍵で検証する。
 * 署名の形式（DERではなく r|s の64バイト）を間違えると、送信先は 401 を返すだけで理由を言わない。
 */

import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const { encryptRecord } = await import(path.join(here, "../src/lib/web-push/encrypt.ts"));
const { buildVapidAuthorization } = await import(path.join(here, "../src/lib/web-push/vapid.ts"));

let failures = 0;

function check(label, ok, detail = "") {
  console.log(`${ok ? "OK  " : "NG  "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

// --- RFC 8291 §5 の例 ---------------------------------------------------------

const PLAINTEXT = "When I grow up, I want to be a watermelon";
const AUTH_SECRET = "BTBZMqHH6r4Tts7J_aSIgg";
const RECEIVER_PUBLIC =
  "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const SENDER_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const EXPECTED_BODY =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
  "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
  "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

const expected = Buffer.from(EXPECTED_BODY, "base64url");

const actual = encryptRecord(Buffer.from(PLAINTEXT, "utf8"), {
  userPublicKey: Buffer.from(RECEIVER_PUBLIC, "base64url"),
  authSecret: Buffer.from(AUTH_SECRET, "base64url"),
  localPrivateKey: Buffer.from(SENDER_PRIVATE, "base64url"),
  // saltは出来上がりのボディの先頭16バイト。例のとおりの値を使う。
  salt: expected.subarray(0, 16),
});

check(
  "RFC 8291 §5 の例と暗号文が一致する",
  actual.equals(expected),
  actual.equals(expected) ? "" : `${actual.toString("base64url").slice(0, 40)}…`,
);
check("レコード長は4096（RFC 8188のヘッダー）", actual.readUInt32BE(16) === 4096);

// --- VAPIDの署名（RFC 8292） --------------------------------------------------

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const publicJwk = createPublicKey(privateKey).export({ format: "jwk" });
const point = Buffer.concat([
  Buffer.from([0x04]),
  pad32(Buffer.from(publicJwk.x, "base64url")),
  pad32(Buffer.from(publicJwk.y, "base64url")),
]);

const endpoint = "https://web.push.apple.com/abcdefg/hijklmn";
const now = new Date("2026-08-22T12:00:00Z");
const header = buildVapidAuthorization(
  endpoint,
  { publicKey: point.toString("base64url"), privateKey, subject: "mailto:test@example.com" },
  now,
);

const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
check("Authorizationヘッダーの形式（vapid t=…, k=…）", Boolean(match));

if (match) {
  const [signingInput, signature] = [match[1].split(".").slice(0, 2).join("."), match[1].split(".")[2]];
  const claims = JSON.parse(Buffer.from(match[1].split(".")[1], "base64url").toString("utf8"));

  check("k= が公開鍵（65バイトの非圧縮点）", Buffer.from(match[2], "base64url").length === 65);
  check("aud は送信先のオリジンだけ", claims.aud === "https://web.push.apple.com", claims.aud);
  check("sub が設定した連絡先", claims.sub === "mailto:test@example.com");
  check(
    "exp は24時間以内",
    claims.exp > now.getTime() / 1000 && claims.exp <= now.getTime() / 1000 + 86_400,
  );

  // 署名の検証は、購読を作った公開鍵（＝ブラウザへ渡した値）から鍵を組み直して行う。
  // 送信先がするのと同じ手順にする。
  const verifyKey = createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: point.subarray(1, 33).toString("base64url"),
      y: point.subarray(33, 65).toString("base64url"),
    },
    format: "jwk",
  });

  check(
    "ES256の署名が公開鍵で検証できる（r|s の64バイト）",
    verify("sha256", Buffer.from(signingInput), { key: verifyKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url")),
  );
}

// --- 環境変数から鍵を読む経路 --------------------------------------------------

process.env.VAPID_PUBLIC_KEY = point.toString("base64url");
process.env.VAPID_PRIVATE_KEY = pad32(
  Buffer.from(privateKey.export({ format: "jwk" }).d, "base64url"),
).toString("base64url");
process.env.VAPID_SUBJECT = "mailto:test@example.com";

const { getVapidKeys } = await import(path.join(here, "../src/lib/web-push/keys.ts"));
const loaded = getVapidKeys();
check("環境変数から読んだ公開鍵が生成した鍵と一致する", loaded.publicKey === process.env.VAPID_PUBLIC_KEY);

// 秘密鍵と対になっていない公開鍵は、読み込みの時点で断る（設定の入れ違いを配信前に見つける）。
const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const otherJwk = createPublicKey(other.privateKey).export({ format: "jwk" });
process.env.VAPID_PUBLIC_KEY = Buffer.concat([
  Buffer.from([0x04]),
  pad32(Buffer.from(otherJwk.x, "base64url")),
  pad32(Buffer.from(otherJwk.y, "base64url")),
]).toString("base64url");

const { getVapidKeys: reload } = await import(
  `${path.join(here, "../src/lib/web-push/keys.ts")}?mismatch`
);
let rejected = false;
try {
  reload();
} catch {
  rejected = true;
}
check("公開鍵と秘密鍵が食い違っていれば読み込みを断る", rejected);

console.log(failures === 0 ? "\nすべて一致しました。" : `\n${failures}件が一致しませんでした。`);
process.exit(failures === 0 ? 0 : 1);

/** P-256の座標は先頭の0が落ちた形で返ることがある。 */
function pad32(value) {
  if (value.length === 32) return value;
  return Buffer.concat([Buffer.alloc(32 - value.length), value]);
}
