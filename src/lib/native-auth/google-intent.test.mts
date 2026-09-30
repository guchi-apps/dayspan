import assert from "node:assert/strict";
import test from "node:test";

import {
  completeIntent,
  INTENT_TTL_MS,
  issueIntent,
  startIntent,
  STATE_TTL_MS,
  type IntentStore,
} from "@/lib/native-auth/google-intent";
import { hashToken } from "@/lib/native-auth/tokens";

type Row = {
  userId: string;
  tokenHash: string;
  usedAt: Date | null;
  expiresAt: Date;
  stateHash: string | null;
  stateExpiresAt: Date | null;
  completedAt: Date | null;
};

function memoryStore() {
  const rows: Row[] = [];
  const store: IntentStore = {
    async create({ userId, tokenHash, expiresAt }) {
      rows.push({ userId, tokenHash, usedAt: null, expiresAt, stateHash: null, stateExpiresAt: null, completedAt: null });
    },
    async start({ tokenHash, stateHash, stateExpiresAt, now }) {
      const row = rows.find((r) => r.tokenHash === tokenHash);
      if (!row || row.usedAt || row.expiresAt <= now) return null;
      row.usedAt = now;
      row.stateHash = stateHash;
      row.stateExpiresAt = stateExpiresAt;
      return { userId: row.userId };
    },
    async findByState(stateHash) {
      const row = rows.find((r) => r.stateHash === stateHash);
      return row ? { userId: row.userId, stateExpiresAt: row.stateExpiresAt, completedAt: row.completedAt } : null;
    },
    async complete(stateHash, now) {
      const row = rows.find((r) => r.stateHash === stateHash);
      if (!row || row.completedAt || !row.stateExpiresAt || row.stateExpiresAt <= now) return false;
      row.completedAt = now;
      return true;
    },
  };
  return { store, rows };
}

const NOW = new Date("2026-09-30T00:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);

async function started(store: IntentStore, userId = "user-a") {
  const token = await issueIntent({ store, userId, now: NOW });
  const result = await startIntent({ store, token, now: NOW });
  assert.ok(result);
  return { token, state: result.state };
}

test("正常系: connect→callbackで、intentのユーザーIDが返る", async () => {
  const { store } = memoryStore();
  const { state } = await started(store, "user-a");
  const result = await completeIntent({ store, state, cookieState: state, now: later(1000) });
  assert.deepEqual(result, { kind: "ok", userId: "user-a" });
});

test("トークンとstateの値そのものは保存しない", async () => {
  const { store, rows } = memoryStore();
  const { token, state } = await started(store);
  assert.equal(rows[0].tokenHash, hashToken(token));
  assert.equal(rows[0].stateHash, hashToken(state));
  assert.notEqual(rows[0].tokenHash, token);
});

test("connect済みのintentで再度connectすると拒否される（ログに残った値の再利用）", async () => {
  const { store } = memoryStore();
  const { token } = await started(store);
  assert.equal(await startIntent({ store, token, now: NOW }), null);
});

test("intentは60秒で期限切れになりconnectできない", async () => {
  const { store } = memoryStore();
  const token = await issueIntent({ store, userId: "user-a", now: NOW });
  assert.equal(await startIntent({ store, token, now: later(INTENT_TTL_MS) }), null);
});

test("発行していないintentはconnectできない", async () => {
  const { store } = memoryStore();
  assert.equal(await startIntent({ store, token: "unknown", now: NOW }), null);
});

test("Cookieのstateと一致しないcallbackは拒否し、intentは潰さない", async () => {
  const { store } = memoryStore();
  const { state } = await started(store);
  assert.deepEqual(await completeIntent({ store, state, cookieState: "other", now: NOW }), { kind: "rejected" });
  assert.deepEqual(await completeIntent({ store, state, cookieState: null, now: NOW }), { kind: "rejected" });
  assert.equal((await completeIntent({ store, state, cookieState: state, now: NOW })).kind, "ok");
});

test("stateの猶予（10分）を過ぎたcallbackは拒否する", async () => {
  const { store } = memoryStore();
  const { state } = await started(store);
  const result = await completeIntent({ store, state, cookieState: state, now: later(STATE_TTL_MS) });
  assert.deepEqual(result, { kind: "rejected" });
});

test("完了済みのintentは再利用できない", async () => {
  const { store } = memoryStore();
  const { state } = await started(store);
  assert.equal((await completeIntent({ store, state, cookieState: state, now: NOW })).kind, "ok");
  assert.deepEqual(await completeIntent({ store, state, cookieState: state, now: NOW }), { kind: "rejected" });
});

test("別ユーザーのintentのstateでは、そのユーザーIDにしか紐付かない", async () => {
  const { store } = memoryStore();
  const a = await started(store, "user-a");
  const b = await started(store, "user-b");
  assert.deepEqual(await completeIntent({ store, state: b.state, cookieState: b.state, now: NOW }), { kind: "ok", userId: "user-b" });
  // Aのstateに、Bのstateを載せたCookieでは通らない
  assert.deepEqual(await completeIntent({ store, state: a.state, cookieState: b.state, now: NOW }), { kind: "rejected" });
});

test("intent由来でないstate（Web/PWAの既存経路）は none として既存経路へ回す", async () => {
  const { store } = memoryStore();
  assert.deepEqual(await completeIntent({ store, state: "web-state", cookieState: "web-state", now: NOW }), { kind: "none" });
  assert.deepEqual(await completeIntent({ store, state: null, cookieState: null, now: NOW }), { kind: "none" });
});

test("ログインCookieがあっても、intent由来のstateならintent経路になる", async () => {
  // 分岐はログインの有無を見ない。completeIntent は state だけで決まる
  const { store } = memoryStore();
  const { state } = await started(store, "user-a");
  assert.equal((await completeIntent({ store, state, cookieState: state, now: NOW })).kind, "ok");
});
