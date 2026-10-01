import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";

import { normalizeApnsPrivateKey } from "@/lib/apns/config";
import { buildApnsJwt } from "@/lib/apns/jwt";
import { buildApnsPayload } from "@/lib/apns/payload";
import { interpretResponse } from "@/lib/apns/send";

test("JWTはES256（r||s の64バイト）で署名され、公開鍵で検証できる", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const now = new Date("2026-10-02T00:00:00Z");
  const jwt = buildApnsJwt({ keyId: "ABC123DEFG", teamId: "TEAM123456", privateKey }, now);
  const [header, claims, signature] = jwt.split(".");

  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), {
    alg: "ES256",
    kid: "ABC123DEFG",
  });
  assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), {
    iss: "TEAM123456",
    iat: Math.floor(now.getTime() / 1000),
  });

  const raw = Buffer.from(signature, "base64url");
  assert.equal(raw.length, 64);
  assert.ok(
    verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, raw),
  );
});

test("秘密鍵はPEM・改行が\\nの1行・base64のどれでも読める", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();

  assert.equal(normalizeApnsPrivateKey(pem), pem);
  assert.equal(normalizeApnsPrivateKey(pem.replace(/\n/g, "\\n")), pem);
  assert.equal(normalizeApnsPrivateKey(Buffer.from(pem).toString("base64")), pem);
});

test("本文はWeb Pushと同じ入力から作り、badge が null なら触らない・0なら送る", () => {
  const base = { title: "10分後 会議", body: "10:00", path: "/calendar?date=2026-10-02" };

  const untouched = buildApnsPayload({ ...base, badge: null });
  assert.equal("badge" in untouched.aps, false);
  assert.equal(untouched.path, "/calendar?date=2026-10-02");

  assert.equal(buildApnsPayload({ ...base, badge: 0 }).aps.badge, 0);
  assert.equal(buildApnsPayload({ ...base, badge: 3, tag: "activity" }).aps["thread-id"], "activity");
});

test("応答の解釈: 200は送信済み、410・BadDeviceTokenは失効、その他は失敗", () => {
  assert.deepEqual(interpretResponse(200, ""), { status: "sent" });
  assert.deepEqual(interpretResponse(410, '{"reason":"Unregistered"}'), { status: "gone" });
  assert.deepEqual(interpretResponse(400, '{"reason":"BadDeviceToken"}'), { status: "gone" });
  assert.deepEqual(interpretResponse(403, '{"reason":"InvalidProviderToken"}'), {
    status: "failed",
    reason: "apns 403 InvalidProviderToken",
  });
  assert.deepEqual(interpretResponse(503, ""), { status: "failed", reason: "apns 503" });
});
