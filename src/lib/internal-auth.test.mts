import assert from "node:assert/strict";
import test from "node:test";

import { resolveInternalUserId } from "@/lib/internal-auth";

test("対象メールが無いサーバー間API要求は対象ユーザーを解決しない", async () => {
  const originalError = console.error;
  console.error = () => {};

  try {
    const userId = await resolveInternalUserId(new Request("https://example.test/api/internal/schedule"));
    assert.equal(userId, null);
  } finally {
    console.error = originalError;
  }
});
