import assert from "node:assert/strict";
import test from "node:test";

import { isPublicPath } from "@/lib/supabase/public-paths";

test("iOSアプリの認証引き継ぎ（start・consume）は未ログインでも通す", () => {
  assert.equal(isPublicPath("/auth/native/start"), true);
  assert.equal(isPublicPath("/auth/native/consume"), true);
});

test("似た名前のパスは公開にならない", () => {
  assert.equal(isPublicPath("/auth/nativeX"), false);
  assert.equal(isPublicPath("/auth/nativeX/start"), false);
  assert.equal(isPublicPath("/auth"), false);
});

test("従来の公開パスは変わらない", () => {
  for (const p of ["/login", "/auth/signin", "/auth/callback"]) {
    assert.equal(isPublicPath(p), true);
  }
  assert.equal(isPublicPath("/calendar"), false);
  assert.equal(isPublicPath("/api/google/connect"), false);
});
