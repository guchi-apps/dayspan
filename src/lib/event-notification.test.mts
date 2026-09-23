import assert from "node:assert/strict";
import test from "node:test";

import { normalizeLeadMinutes, resolveEventLeadMinutes } from "@/lib/event-notification";

test("normalizeLeadMinutes: 許容値のみ残し、重複を除いて昇順に並べる", () => {
  assert.deepEqual(normalizeLeadMinutes([30, 10, 10, 0]), [0, 10, 30]);
});

test("normalizeLeadMinutes: 選択肢に無い値は落とす", () => {
  assert.deepEqual(normalizeLeadMinutes([10, 7, -5, 999]), [10]);
});

test("normalizeLeadMinutes: 空配列は空配列のまま", () => {
  assert.deepEqual(normalizeLeadMinutes([]), []);
});

test("resolveEventLeadMinutes: 上書きが無ければ通知しない（オプトイン）", () => {
  assert.deepEqual(resolveEventLeadMinutes(null, true), []);
});

test("resolveEventLeadMinutes: 通知を入れていない上書きは空", () => {
  assert.deepEqual(resolveEventLeadMinutes({ enabled: false, leadMinutes: [10] }, true), []);
});

test("resolveEventLeadMinutes: 通知を入れた予定は指定のleadMinutesをそのまま使う", () => {
  assert.deepEqual(resolveEventLeadMinutes({ enabled: true, leadMinutes: [10, 30] }, true), [
    10, 30,
  ]);
});

test("resolveEventLeadMinutes: アカウントの予定通知がオフなら入れた予定も空", () => {
  assert.deepEqual(resolveEventLeadMinutes({ enabled: true, leadMinutes: [10] }, false), []);
});
