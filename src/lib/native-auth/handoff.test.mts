import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  consumeHandoff,
  HANDOFF_PURPOSE_LOGIN,
  HANDOFF_TTL_MS,
  issueHandoff,
  type HandoffRecord,
  type HandoffStore,
} from "@/lib/native-auth/handoff";
import { isValidChallenge, isValidVerifier, s256Challenge } from "@/lib/native-auth/tokens";

/** 本番のstoreと同じく「未使用・期限内・用途一致」を一度だけ確保できる、メモリ上の実装。 */
function memoryStore() {
  const rows = new Map<string, HandoffRecord & { usedAt: Date | null }>();
  const store: HandoffStore = {
    async create(record) {
      rows.set(record.codeHash, { ...record, usedAt: null });
    },
    async claim(codeHash, purpose, now) {
      const row = rows.get(codeHash);
      if (!row || row.usedAt || row.purpose !== purpose || row.expiresAt <= now) return null;
      row.usedAt = now;
      return { challengeHash: row.challengeHash, sessionCipher: row.sessionCipher, next: row.next };
    },
  };
  return { store, rows };
}

const VERIFIER = "a".repeat(43);
const NOW = new Date("2026-09-30T00:00:00Z");

async function issue(store: HandoffStore, verifier = VERIFIER) {
  return issueHandoff({
    store,
    challenge: s256Challenge(verifier),
    sessionCipher: "cipher",
    next: "/tasks",
    now: NOW,
  });
}

test("正常系: コードとverifierで一度だけ消費でき、暗号化済みセッションと遷移先が返る", async () => {
  const { store } = memoryStore();
  const code = await issue(store);
  const result = await consumeHandoff({ store, code, verifier: VERIFIER, now: NOW });
  assert.deepEqual(result, { sessionCipher: "cipher", next: "/tasks" });
});

test("コードの値そのものはDBへ保存しない（ハッシュのみ）", async () => {
  const { store, rows } = memoryStore();
  const code = await issue(store);
  assert.equal(rows.has(code), false);
  assert.equal([...rows.keys()][0].length, 64);
});

test("期限切れのコードは拒否する", async () => {
  const { store } = memoryStore();
  const code = await issue(store);
  const later = new Date(NOW.getTime() + HANDOFF_TTL_MS);
  assert.equal(await consumeHandoff({ store, code, verifier: VERIFIER, now: later }), null);
});

test("一度使ったコードは再利用できない", async () => {
  const { store } = memoryStore();
  const code = await issue(store);
  assert.ok(await consumeHandoff({ store, code, verifier: VERIFIER, now: NOW }));
  assert.equal(await consumeHandoff({ store, code, verifier: VERIFIER, now: NOW }), null);
});

test("同時に2回消費しても成功するのは1回だけ", async () => {
  const { store } = memoryStore();
  const code = await issue(store);
  const results = await Promise.all([
    consumeHandoff({ store, code, verifier: VERIFIER, now: NOW }),
    consumeHandoff({ store, code, verifier: VERIFIER, now: NOW }),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
});

test("verifierが違えば拒否し、そのコードは使えなくなる（総当たりさせない）", async () => {
  const { store } = memoryStore();
  const code = await issue(store);
  assert.equal(await consumeHandoff({ store, code, verifier: "b".repeat(43), now: NOW }), null);
  assert.equal(await consumeHandoff({ store, code, verifier: VERIFIER, now: NOW }), null);
});

test("用途違いのコードは拒否する", async () => {
  const { store, rows } = memoryStore();
  const code = await issue(store);
  for (const row of rows.values()) (row as { purpose: string }).purpose = "other";
  assert.equal(await consumeHandoff({ store, code, verifier: VERIFIER, now: NOW }), null);
});

test("発行していないコードは拒否する", async () => {
  const { store } = memoryStore();
  assert.equal(await consumeHandoff({ store, code: "unknown", verifier: VERIFIER, now: NOW }), null);
});

test("PKCEの形式検証", () => {
  assert.equal(isValidChallenge(s256Challenge(VERIFIER)), true);
  assert.equal(isValidChallenge("short"), false);
  assert.equal(isValidChallenge(undefined), false);
  assert.equal(isValidVerifier(VERIFIER), true);
  assert.equal(isValidVerifier("short"), false);
  assert.equal(isValidVerifier("a".repeat(129)), false);
  assert.equal(isValidVerifier("a".repeat(42) + "!"), false);
  assert.equal(HANDOFF_PURPOSE_LOGIN, "login");
});

test("/auth/callback は許可判定を通ったあとでしか引き継ぎコードを発行しない", () => {
  const source = readFileSync(new URL("../../app/auth/callback/route.ts", import.meta.url), "utf-8");
  const allowed = source.indexOf("isUserAllowed(user)");
  const issued = source.indexOf("issueHandoff(");
  assert.ok(allowed > 0 && issued > allowed);
  // 許可外はアプリへコードではなく not_allowed を返す
  assert.match(source, /nativeLoginErrorUrl\("not_allowed"\)/);
});
