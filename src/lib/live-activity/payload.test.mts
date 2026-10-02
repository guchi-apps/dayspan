import assert from "node:assert/strict";
import test from "node:test";

import { buildApnsHeaders } from "@/lib/apns/send";
import {
  buildLiveActivityPayload,
  planLiveActivity,
  toContentState,
} from "@/lib/live-activity/payload";

const running = { title: "仕事", startedAt: "2026-10-02T01:00:00.000Z" };

test("ContentStateの時刻はUnix秒の数値", () => {
  const state = toContentState(running);
  assert.equal(typeof state.startedAtEpoch, "number");
  assert.equal(state.startedAtEpoch, Date.parse(running.startedAt) / 1000);
});

test("新規開始はstart、切り替えは更新先があればupdate1通、無ければstart", () => {
  assert.equal(planLiveActivity({ type: "started", running, switched: false }, true), "start");
  assert.equal(planLiveActivity({ type: "started", running, switched: true }, true), "update");
  assert.equal(planLiveActivity({ type: "started", running, switched: true }, false), "start");
});

test("停止はend、開始時刻の修正は更新先があればupdate", () => {
  assert.equal(planLiveActivity({ type: "stopped" }, true), "end");
  assert.equal(planLiveActivity({ type: "updated", running }, true), "update");
  assert.equal(planLiveActivity({ type: "updated", running }, false), "start");
});

test("startの本文は属性の型名・content-state・alertを持つ", () => {
  const payload = buildLiveActivityPayload("start", running, 1000) as { aps: Record<string, unknown> };
  assert.equal(payload.aps.event, "start");
  assert.equal(payload.aps["attributes-type"], "RecordingActivityAttributes");
  assert.deepEqual(payload.aps["content-state"], toContentState(running));
  assert.ok(payload.aps.alert);
});

test("endは即時に消す", () => {
  const payload = buildLiveActivityPayload("end", null, 1000) as { aps: Record<string, unknown> };
  assert.equal(payload.aps.event, "end");
  assert.equal(payload.aps["dismissal-date"], 1000);
});

test("liveactivityのヘッダーはtopicに.push-type.liveactivityを付け、alertは付けない", () => {
  const live = buildApnsHeaders({
    token: "ab", jwt: "j", bundleId: "com.example.app", pushType: "liveactivity", priority: 10, expiresAt: 1,
  });
  assert.equal(live["apns-topic"], "com.example.app.push-type.liveactivity");
  assert.equal(live["apns-push-type"], "liveactivity");

  const alert = buildApnsHeaders({
    token: "ab", jwt: "j", bundleId: "com.example.app", pushType: "alert", priority: 10, expiresAt: 1, collapseId: "x",
  });
  assert.equal(alert["apns-topic"], "com.example.app");
  assert.equal(alert["apns-push-type"], "alert");
  assert.equal(alert["apns-collapse-id"], "x");
});
