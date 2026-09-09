import assert from "node:assert/strict";
import test from "node:test";

import { findOverlappingSleepSpan, parseSleepRangeBody } from "@/lib/sleep-shortcut";

const NOW = new Date("2026-09-09T06:45:00.000Z");

test("parseSleepRangeBody: start と end をそのまま採る", () => {
  const result = parseSleepRangeBody(
    { start: "2026-09-08T23:35:00.000Z", end: "2026-09-09T06:45:00.000Z" },
    NOW,
  );

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.start.toISOString(), "2026-09-08T23:35:00.000Z");
  assert.equal(result.end.toISOString(), "2026-09-09T06:45:00.000Z");
});

test("parseSleepRangeBody: end と minutes から開始を逆算する", () => {
  const result = parseSleepRangeBody({ end: "2026-09-09T06:45:00.000Z", minutes: 430 }, NOW);

  assert.ok(result.ok);
  assert.equal(result.start.toISOString(), "2026-09-08T23:35:00.000Z");
  assert.equal(result.end.toISOString(), "2026-09-09T06:45:00.000Z");
});

test("parseSleepRangeBody: minutes だけなら終わりは「いま」", () => {
  const result = parseSleepRangeBody({ minutes: 430 }, NOW);

  assert.ok(result.ok);
  assert.equal(result.end.toISOString(), NOW.toISOString());
  assert.equal(result.start.toISOString(), "2026-09-08T23:35:00.000Z");
});

test("parseSleepRangeBody: start と minutes が両方来たら start を採る", () => {
  const result = parseSleepRangeBody(
    { start: "2026-09-08T22:00:00.000Z", end: "2026-09-09T06:45:00.000Z", minutes: 60 },
    NOW,
  );

  assert.ok(result.ok);
  assert.equal(result.start.toISOString(), "2026-09-08T22:00:00.000Z");
});

test("parseSleepRangeBody: 数字の文字列と小数の minutes も受ける", () => {
  const asText = parseSleepRangeBody({ minutes: " 430 " }, NOW);
  assert.ok(asText.ok);
  assert.equal(asText.start.toISOString(), "2026-09-08T23:35:00.000Z");

  // Apple Watchの秒単位の値を60で割ると小数になる。分へ丸める。
  const asFraction = parseSleepRangeBody({ minutes: 429.6 }, NOW);
  assert.ok(asFraction.ok);
  assert.equal(asFraction.start.toISOString(), "2026-09-08T23:35:00.000Z");
});

test("parseSleepRangeBody: 何も送られていなければ断る", () => {
  const result = parseSleepRangeBody({}, NOW);

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.match(result.message, /start と end、または minutes/);
});

test("parseSleepRangeBody: end だけでは決まらない", () => {
  const result = parseSleepRangeBody({ end: "2026-09-09T06:45:00.000Z" }, NOW);

  assert.ok(!result.ok);
});

test("parseSleepRangeBody: 読めない日時は断る", () => {
  const badStart = parseSleepRangeBody({ start: "きのうの夜", end: "2026-09-09T06:45:00.000Z" }, NOW);
  assert.ok(!badStart.ok);
  assert.match(badStart.message, /start/);

  const badEnd = parseSleepRangeBody({ start: "2026-09-08T23:35:00.000Z", end: "けさ" }, NOW);
  assert.ok(!badEnd.ok);
  assert.match(badEnd.message, /end/);
});

test("parseSleepRangeBody: start が end 以降なら断る", () => {
  const result = parseSleepRangeBody(
    { start: "2026-09-09T06:45:00.000Z", end: "2026-09-09T06:45:00.000Z" },
    NOW,
  );

  assert.ok(!result.ok);
  assert.match(result.message, /start が end 以降/);
});

test("parseSleepRangeBody: 幅の外の minutes は断る", () => {
  for (const minutes of [0, -30, 1441, "ななじかん"]) {
    const result = parseSleepRangeBody({ minutes }, NOW);
    assert.ok(!result.ok, `minutes=${String(minutes)} は断られるはず`);
  }
});

test("findOverlappingSleepSpan: 重なっていればその相手を返す", () => {
  const spans = [{ start: 100, end: 200 }];

  assert.deepEqual(findOverlappingSleepSpan({ start: 150, end: 250 }, spans), spans[0]);
  assert.deepEqual(findOverlappingSleepSpan({ start: 50, end: 150 }, spans), spans[0]);
  // 丸ごと含む・丸ごと含まれるのも重なり。
  assert.deepEqual(findOverlappingSleepSpan({ start: 0, end: 300 }, spans), spans[0]);
  assert.deepEqual(findOverlappingSleepSpan({ start: 120, end: 180 }, spans), spans[0]);
});

test("findOverlappingSleepSpan: 端が接するだけなら重なりにしない", () => {
  const spans = [{ start: 100, end: 200 }];

  assert.equal(findOverlappingSleepSpan({ start: 200, end: 300 }, spans), null);
  assert.equal(findOverlappingSleepSpan({ start: 0, end: 100 }, spans), null);
});

test("findOverlappingSleepSpan: 何も無ければ null", () => {
  assert.equal(findOverlappingSleepSpan({ start: 100, end: 200 }, []), null);
});

test("findOverlappingSleepSpan: 重なる相手が複数あれば先頭を返す", () => {
  const spans = [
    { start: 300, end: 400 },
    { start: 100, end: 200 },
  ];

  assert.deepEqual(findOverlappingSleepSpan({ start: 0, end: 500 }, spans), spans[0]);
});
