import assert from "node:assert/strict";
import test from "node:test";

import { signOutThisApp, type SignOutClient } from "@/lib/supabase/sign-out";

function fakeClient() {
  const calls: unknown[][] = [];
  const client: SignOutClient = {
    auth: {
      async signOut(...args) {
        calls.push(args);
        return { error: null };
      },
    },
  };
  return { client, calls };
}

test("ログアウトは scope: local を渡し、他アプリのセッションを失効させない", async () => {
  const { client, calls } = fakeClient();
  await signOutThisApp(client);
  assert.deepEqual(calls, [[{ scope: "local" }]]);
});

test("Supabaseが返したエラーはそのまま呼び出し元へ返す", async () => {
  const client: SignOutClient = {
    auth: { signOut: async () => ({ error: { message: "boom" } }) },
  };
  const { error } = await signOutThisApp(client);
  assert.equal(error?.message, "boom");
});
