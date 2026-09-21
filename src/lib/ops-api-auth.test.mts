import assert from "node:assert/strict";
import test from "node:test";

import { isOpsApiAuthorized } from "@/lib/ops-api-auth";

test("isOpsApiAuthorized: 一致するBearerだけを通す", () => {
  assert.equal(isOpsApiAuthorized("Bearer secret-token", "secret-token"), true);
  assert.equal(isOpsApiAuthorized("Bearer wrong-token!", "secret-token"), false);
  // 長さが違うと timingSafeEqual は例外を投げるため、先に弾いていること
  assert.equal(isOpsApiAuthorized("Bearer short", "secret-token"), false);
});

test("isOpsApiAuthorized: ヘッダーが無い・Bearerでない形は通さない", () => {
  assert.equal(isOpsApiAuthorized(null, "secret-token"), false);
  assert.equal(isOpsApiAuthorized("", "secret-token"), false);
  assert.equal(isOpsApiAuthorized("secret-token", "secret-token"), false);
  assert.equal(isOpsApiAuthorized("Basic secret-token", "secret-token"), false);
});

test("isOpsApiAuthorized: サーバー側が未設定・空なら、ヘッダーが何でも通さない", () => {
  assert.equal(isOpsApiAuthorized("Bearer ", ""), false);
  assert.equal(isOpsApiAuthorized("Bearer ", undefined), false);
  assert.equal(isOpsApiAuthorized("Bearer anything", undefined), false);
});
