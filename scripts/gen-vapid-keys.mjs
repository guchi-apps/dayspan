#!/usr/bin/env node
/**
 * 通知（Web Push）に使うVAPID鍵を作る（docs/notifications.md）。
 *
 * 使い方:
 *   node scripts/gen-vapid-keys.mjs [mailto:you@example.com]
 *
 * 出力した3行を .env.local（ローカル）と1Password（本番の正）へ入れる。
 * 鍵を作り直すと、それまでに登録された端末には届かなくなる（購読し直しが要る）。
 */

import { generateKeyPairSync, createPublicKey } from "node:crypto";

const subject = process.argv[2] ?? "mailto:admin@example.com";

if (!subject.startsWith("mailto:") && !subject.startsWith("https://")) {
  console.error("VAPID_SUBJECT は mailto: か https:// で始まる必要があります。");
  process.exit(1);
}

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });

const privateJwk = privateKey.export({ format: "jwk" });
const publicJwk = createPublicKey(privateKey).export({ format: "jwk" });

// 公開鍵はブラウザの subscribe() がそのまま受け取る65バイトの非圧縮点（0x04 + x + y）。
const point = Buffer.concat([
  Buffer.from([0x04]),
  pad32(Buffer.from(publicJwk.x, "base64url")),
  pad32(Buffer.from(publicJwk.y, "base64url")),
]);

console.log("# .env.local と1Passwordへ入れる値（1行ずつ）");
console.log(`VAPID_PUBLIC_KEY=${point.toString("base64url")}`);
console.log(`VAPID_PRIVATE_KEY=${pad32(Buffer.from(privateJwk.d, "base64url")).toString("base64url")}`);
console.log(`VAPID_SUBJECT=${subject}`);

/** 座標は先頭の0が落ちた形で返ることがある。32バイトへそろえないと点が短くなる。 */
function pad32(value) {
  if (value.length === 32) return value;
  if (value.length > 32) throw new Error("P-256の値が32バイトを超えています。");
  return Buffer.concat([Buffer.alloc(32 - value.length), value]);
}
