import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPendingOps,
  classifyResponse,
  nextSendable,
  rebaseExpected,
  type PendingOp,
} from "@/lib/activity-queue/ops";

const T0 = "2026-10-02T00:00:00.000Z";
const T1 = "2026-10-02T01:00:00.000Z";
const T2 = "2026-10-02T02:00:00.000Z";

const start = (id: string, title: string, at: string): PendingOp => ({
  id,
  kind: "start",
  title,
  createdAt: at,
  at,
});
const stop = (id: string, expected: { startedAt: string; title: string }): PendingOp => ({
  id,
  kind: "stop",
  createdAt: T2,
  expected,
});

test("applyPendingOps: 開始→停止の順に重ねると記録中ではなくなる", () => {
  const ops = [start("1", "仕事", T0), stop("2", { startedAt: T0, title: "仕事" })];
  assert.equal(applyPendingOps(null, ops), null);
});

test("applyPendingOps: オフラインで始めた記録が見かけ上の記録になる", () => {
  const result = applyPendingOps(null, [start("1", "睡眠", T1)]);
  assert.equal(result?.title, "睡眠");
  assert.equal(result?.startedAt, T1);
});

test("applyPendingOps: 開始時刻の修正だけが記録中の開始を動かす", () => {
  const server = { title: "仕事", calendarId: "c", startedAt: T1 };
  const result = applyPendingOps(server, [
    {
      id: "1",
      kind: "updateStart",
      createdAt: T2,
      startedAt: T0,
      expected: { startedAt: T1, title: "仕事" },
    },
  ]);
  assert.equal(result?.startedAt, T0);
  assert.equal(result?.title, "仕事");
});

test("rebaseExpected: 開始の時刻が変わったら、後ろの停止の前提条件も直す", () => {
  const ops = [stop("2", { startedAt: T0, title: "仕事" })];
  const [rebased] = rebaseExpected(ops, T0, T1);
  assert.equal(rebased.kind === "stop" && rebased.expected.startedAt, T1);
});

test("rebaseExpected: 別の記録への前提条件は触らない", () => {
  const ops = [stop("2", { startedAt: T2, title: "別" })];
  assert.deepEqual(rebaseExpected(ops, T0, T1), ops);
});

test("classifyResponse: 完了扱いは error の値で決め、ステータスだけでは決めない", () => {
  assert.equal(classifyResponse(404, { error: "not_running" }).type, "gone");
  assert.equal(classifyResponse(409, { error: "record_changed" }).type, "gone");
  // 保存先の設定ミスは「他で処理済み」として黙って消さない
  assert.equal(classifyResponse(404, { error: "calendar_not_found", message: "x" }).type, "hold");
});

test("classifyResponse: 401・5xxは残して再試行、401は再ログインを促す", () => {
  assert.deepEqual(classifyResponse(401, { error: "unauthorized" }), {
    type: "retry",
    authRequired: true,
  });
  assert.deepEqual(classifyResponse(503, null), { type: "retry" });
});

test("classifyResponse: 未来の時刻と記録中より前の時刻を分ける", () => {
  assert.equal(classifyResponse(400, { error: "future_time" }).type, "future_time");
  const before = classifyResponse(400, { error: "before_running" });
  assert.equal(before.type, "hold");
});

test("nextSendable: 保留中の操作があれば、順序を守って後ろも送らない", () => {
  const held: PendingOp = { ...start("1", "仕事", T0), heldReason: "重なり" };
  assert.equal(nextSendable([held, start("2", "睡眠", T1)]), null);
  assert.equal(nextSendable([start("2", "睡眠", T1)])?.id, "2");
});
