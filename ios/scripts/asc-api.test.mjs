// asc-api.mjs の純関数のテスト（`node --test ios/scripts/*.test.mjs`）。ネットワークは使わない。

import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { describe, it } from "node:test";

import { createJwt, pickApiCreatedDevCertificates, pickInternalGroup } from "./asc-api.mjs";

const g = (name, isInternalGroup) => ({ id: name, attributes: { name, isInternalGroup } });

describe("createJwt", () => {
  it("ES256の3部構成で、署名が公開鍵で検証できる", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" });
    const jwt = createJwt({ keyId: "KID", issuerId: "ISS", privateKeyPem: pem, now: 1_000_000 });
    const [h, p, s] = jwt.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "KID", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p, "base64url"));
    assert.equal(payload.iss, "ISS");
    assert.equal(payload.aud, "appstoreconnect-v1");
    assert.equal(payload.exp - payload.iat, 600);
    assert.ok(
      verify("sha256", Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))
    );
  });
});

describe("pickInternalGroup", () => {
  it("名前指定があれば内部グループからその名前を選ぶ（外部グループは選ばない）", () => {
    assert.equal(pickInternalGroup([g("A", false), g("A", true), g("B", true)], "A").attributes.isInternalGroup, true);
  });
  it("名前が無くても内部グループが1つなら選べる", () => {
    assert.equal(pickInternalGroup([g("外部", false), g("自分", true)], "").id, "自分");
  });
  it("内部グループが複数で名前が無いと失敗する", () => {
    assert.throws(() => pickInternalGroup([g("A", true), g("B", true)], ""), /1つに決められません/);
  });
  it("指定した名前が無いと失敗する", () => {
    assert.throws(() => pickInternalGroup([g("A", true)], "Z"), /見つかりません/);
  });
});

describe("pickApiCreatedDevCertificates", () => {
  // 実際の応答の形: name は種別の接頭辞付き、displayName が素の名前（#1010 で実応答から確認）
  const c = (id, displayName, certificateType, prefix = "Apple Development") => ({
    id,
    attributes: { name: `${prefix}: ${displayName}`, displayName, certificateType },
  });
  it("API作成のDevelopment証明書だけを選ぶ（自分用・Distributionは残す）", () => {
    const picked = pickApiCreatedDevCertificates([
      c("1", "Created via API", "DEVELOPMENT"),
      c("2", "Created via API", "IOS_DEVELOPMENT", "iOS Development"),
      c("3", "Kazuki Guchi", "DEVELOPMENT"),
      c("4", "Created via API", "DISTRIBUTION", "Apple Distribution"),
      c("5", "Created via API", "IOS_DISTRIBUTION", "iPhone Distribution"),
    ]);
    assert.deepEqual(picked.map((x) => x.id), ["1", "2"]);
  });
  it("接頭辞付きの name だけでは選ばない（displayName で判定する）", () => {
    const picked = pickApiCreatedDevCertificates([
      { id: "6", attributes: { name: "Apple Development: Created via API", certificateType: "DEVELOPMENT" } },
    ]);
    assert.deepEqual(picked, []);
  });
});
