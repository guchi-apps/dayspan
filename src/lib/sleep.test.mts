import assert from "node:assert/strict";
import test from "node:test";

import { sleepNightKey } from "@/lib/sleep";

const TZ = "Asia/Tokyo";

test("sleepNightKey: 正午以降はその日の行", () => {
  assert.equal(sleepNightKey("2026-09-08T12:00:00+09:00", TZ), "2026-09-08");
  assert.equal(sleepNightKey("2026-09-08T23:35:00+09:00", TZ), "2026-09-08");
});

test("sleepNightKey: 正午より前は前日の行（朝は昨夜のぶん）", () => {
  assert.equal(sleepNightKey("2026-09-09T06:45:00+09:00", TZ), "2026-09-08");
  assert.equal(sleepNightKey("2026-09-09T00:00:00+09:00", TZ), "2026-09-08");
  assert.equal(sleepNightKey("2026-09-09T11:59:00+09:00", TZ), "2026-09-08");
});

test("sleepNightKey: 同じ夜の就寝と起床は同じ行になる", () => {
  assert.equal(
    sleepNightKey("2026-09-08T23:35:00+09:00", TZ),
    sleepNightKey("2026-09-09T06:45:00+09:00", TZ),
  );
});

test("sleepNightKey: 翌晩の就寝は別の行になる（止め損ねた記録を見分けられる）", () => {
  assert.notEqual(
    sleepNightKey("2026-09-08T23:35:00+09:00", TZ),
    sleepNightKey("2026-09-09T23:35:00+09:00", TZ),
  );
});

test("sleepNightKey: 月・年をまたいでも前日へ戻せる", () => {
  assert.equal(sleepNightKey("2026-10-01T03:00:00+09:00", TZ), "2026-09-30");
  assert.equal(sleepNightKey("2027-01-01T03:00:00+09:00", TZ), "2026-12-31");
});

test("sleepNightKey: 判定は設定タイムゾーンで行う（UTCの表記でも同じ夜）", () => {
  // 2026-09-08T14:35:00Z = JSTの 09-08 23:35。
  assert.equal(sleepNightKey("2026-09-08T14:35:00.000Z", TZ), "2026-09-08");
  // 同じ瞬間をUTCで見ると正午より前なので、タイムゾーンが違えば行も変わる。
  assert.equal(sleepNightKey("2026-09-08T14:35:00.000Z", "UTC"), "2026-09-08");
  assert.equal(sleepNightKey("2026-09-08T02:00:00.000Z", "UTC"), "2026-09-07");
});
