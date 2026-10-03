import assert from "node:assert/strict";
import test from "node:test";

import { parseTargetEmail } from "@/lib/internal-target";

test("未指定・空は none", () => {
  assert.deepEqual(parseTargetEmail(null), { kind: "none" });
  assert.deepEqual(parseTargetEmail("  "), { kind: "none" });
});

test("メールは小文字化して返す", () => {
  assert.deepEqual(parseTargetEmail(" A@Example.com "), { kind: "email", email: "a@example.com" });
});

test("複数・形の崩れた値は invalid", () => {
  assert.deepEqual(parseTargetEmail("a@x.com,b@x.com"), { kind: "invalid" });
  assert.deepEqual(parseTargetEmail("not-an-email"), { kind: "invalid" });
});
