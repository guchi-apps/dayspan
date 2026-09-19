import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSleepHealthUntil,
  selectSleepForHealth,
  sleepHealthWindowStart,
  toOffsetIso,
} from "@/lib/sleep-health";

const NOW = new Date("2026-09-19T00:00:00.000Z"); // 09:00 JST
const TZ = "Asia/Tokyo";

function event(start: string, end: string, extra: Record<string, unknown> = {}) {
  return { summary: "睡眠", start: { dateTime: start }, end: { dateTime: end }, ...extra };
}

test("toOffsetIso: 利用者のタイムゾーンのオフセット付きで秒まで出す", () => {
  assert.equal(toOffsetIso(new Date("2026-09-18T14:35:30.000Z"), TZ), "2026-09-18T23:35:30+09:00");
  assert.equal(toOffsetIso(new Date("2026-09-18T14:35:00.000Z"), "UTC"), "2026-09-18T14:35:00+00:00");
  assert.equal(
    toOffsetIso(new Date("2026-01-15T12:00:00.000Z"), "America/New_York"),
    "2026-01-15T07:00:00-05:00",
  );
});

test("sleepHealthWindowStart: 印が無ければ直近2日", () => {
  assert.equal(sleepHealthWindowStart(null, NOW).toISOString(), "2026-09-17T00:00:00.000Z");
});

test("sleepHealthWindowStart: 印があればそこから、古すぎれば30日で切る", () => {
  const until = new Date("2026-09-18T21:45:00.000Z");
  assert.equal(sleepHealthWindowStart(until, NOW).toISOString(), until.toISOString());
  assert.equal(
    sleepHealthWindowStart(new Date("2026-01-01T00:00:00.000Z"), NOW).toISOString(),
    "2026-08-20T00:00:00.000Z",
  );
});

test("selectSleepForHealth: 睡眠の項目名・時刻付き・印より後に終わったものを終わった順に返す", () => {
  const items = selectSleepForHealth(
    [
      event("2026-09-18T14:35:00Z", "2026-09-18T21:45:00Z"),
      event("2026-09-18T05:00:00Z", "2026-09-18T05:40:00Z"), // 昼寝（先に終わっている）
      { summary: "仕事", start: { dateTime: "2026-09-18T01:00:00Z" }, end: { dateTime: "2026-09-18T09:00:00Z" } },
      { summary: "睡眠", start: {}, end: {} }, // 終日
      event("2026-09-17T14:00:00Z", "2026-09-17T21:00:00Z"), // 印より前に終わっている
    ],
    { title: "睡眠", after: new Date("2026-09-17T22:00:00Z"), now: NOW, timeZone: TZ },
  );

  assert.deepEqual(
    items.map(({ start, end }) => ({ start, end })),
    [
      { start: "2026-09-18T14:00:00+09:00", end: "2026-09-18T14:40:00+09:00" },
      { start: "2026-09-18T23:35:00+09:00", end: "2026-09-19T06:45:00+09:00" },
    ],
  );
});

test("selectSleepForHealth: 印とちょうど同じ時刻に終わったもの（送り済み）は返さない", () => {
  const items = selectSleepForHealth([event("2026-09-18T14:35:00Z", "2026-09-18T21:45:00Z")], {
    title: "睡眠",
    after: new Date("2026-09-18T21:45:00Z"),
    now: NOW,
    timeZone: TZ,
  });
  assert.equal(items.length, 0);
});

test("selectSleepForHealth: ヘルスケアから取り込んだ睡眠は送り返さない", () => {
  const items = selectSleepForHealth(
    [
      event("2026-09-18T14:35:00Z", "2026-09-18T21:45:00Z", {
        extendedProperties: { private: { dayspanSource: "health" } },
      }),
    ],
    { title: "睡眠", after: new Date("2026-09-17T00:00:00Z"), now: NOW, timeZone: TZ },
  );
  assert.equal(items.length, 0);
});

test("selectSleepForHealth: まだ終わっていない予定（終わりが未来）は送らない", () => {
  const items = selectSleepForHealth([event("2026-09-18T23:00:00Z", "2026-09-19T01:00:00Z")], {
    title: "睡眠",
    after: new Date("2026-09-17T00:00:00Z"),
    now: NOW,
    timeZone: TZ,
  });
  assert.equal(items.length, 0);
});

test("parseSleepHealthUntil: GETで返した値をそのまま読む", () => {
  const result = parseSleepHealthUntil("2026-09-19T06:45:00+09:00", NOW);
  assert.ok(result.ok);
  assert.equal(result.until.toISOString(), "2026-09-18T21:45:00.000Z");
});

test("parseSleepHealthUntil: 欠け・読めない値・未来は断る", () => {
  assert.equal(parseSleepHealthUntil(undefined, NOW).ok, false);
  assert.equal(parseSleepHealthUntil("", NOW).ok, false);
  assert.equal(parseSleepHealthUntil("きのう", NOW).ok, false);
  assert.equal(parseSleepHealthUntil("2026-09-19T00:05:00Z", NOW).ok, false);
  assert.equal(parseSleepHealthUntil("2026-09-19T00:00:30Z", NOW).ok, true);
});
