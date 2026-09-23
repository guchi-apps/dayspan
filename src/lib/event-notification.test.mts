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

test("resolveEventLeadMinutes: 上書きが無ければアカウント既定（オン）を1件使う", () => {
  assert.deepEqual(resolveEventLeadMinutes(null, true, 10), [10]);
});

test("resolveEventLeadMinutes: 上書きが無くアカウント既定がオフなら空", () => {
  assert.deepEqual(resolveEventLeadMinutes(null, false, 10), []);
});

test("resolveEventLeadMinutes: 上書きで通知しないと決めていれば、アカウント既定がオンでも空", () => {
  assert.deepEqual(resolveEventLeadMinutes({ enabled: false, leadMinutes: [10] }, true, 10), []);
});

test("resolveEventLeadMinutes: 上書きで複数のleadMinutesを指定していればそれをそのまま使う", () => {
  assert.deepEqual(
    resolveEventLeadMinutes({ enabled: true, leadMinutes: [10, 30] }, true, 60),
    [10, 30],
  );
});
