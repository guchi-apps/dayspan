import assert from "node:assert/strict";
import test from "node:test";

import { findOverlappingSleepSpan } from "@/lib/sleep-shortcut";

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
