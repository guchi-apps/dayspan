import assert from "node:assert/strict";
import test from "node:test";

import { parseGoogleMapsDuration } from "@/lib/google-maps-duration";

test("時間と分を合算する", () => {
  assert.equal(parseGoogleMapsDuration("1 時間 5 分"), 65);
  assert.equal(parseGoogleMapsDuration("1時間5分 (42 km)"), 65);
  assert.equal(parseGoogleMapsDuration("1 hr 5 min"), 65);
});

test("分だけ・時間だけ", () => {
  assert.equal(parseGoogleMapsDuration("25 分"), 25);
  assert.equal(parseGoogleMapsDuration("45 min"), 45);
  assert.equal(parseGoogleMapsDuration("2時間"), 120);
});

test("複数あれば先頭だけを読む", () => {
  assert.equal(parseGoogleMapsDuration("25 分 12 km\n32 分 15 km"), 25);
  assert.equal(parseGoogleMapsDuration("1 時間 5 分\n40 分"), 65);
});

test("読めない・範囲外は null", () => {
  assert.equal(parseGoogleMapsDuration(""), null);
  assert.equal(parseGoogleMapsDuration("経路なし"), null);
  assert.equal(parseGoogleMapsDuration("0 分"), null);
  assert.equal(parseGoogleMapsDuration("99 時間"), null);
});
