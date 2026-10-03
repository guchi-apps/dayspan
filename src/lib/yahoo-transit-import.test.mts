import assert from "node:assert/strict";
import test from "node:test";

import { buildYahooTravelImport } from "@/lib/yahoo-transit-import";

const SAMPLE = `草津(滋賀県) ⇒ 高槻
2026年8月28日(金)
20:58 ⇒ 21:46
------------------------------
所要時間 48分
乗換 0回
------------------------------

■草津(滋賀県)
↓ 20:58〜21:21
■高槻

[Yahoo!乗換案内]
https://transit.yahoo.co.jp/smartphone/app/`;

test("検索日・駅名・時刻を設定タイムゾーンのISOへ直して取り込む", () => {
  const result = buildYahooTravelImport(SAMPLE, "Asia/Tokyo");
  assert.ok(result.ok);
  assert.equal(result.travel.origin, "草津");
  assert.equal(result.travel.destination, "高槻");
  assert.equal(result.travel.mode, "PUBLIC_TRANSIT");
  assert.equal(result.travel.estimateSource, "YAHOO");
  assert.equal(result.travel.departAt, "2026-08-28T11:58:00.000Z");
  assert.equal(result.travel.arriveAt, "2026-08-28T12:46:00.000Z");
  assert.ok(!result.travel.note.includes("Yahoo!乗換案内]"));
});

test("Asia/Tokyoの08:10は前日の23:10Zになる", () => {
  const text = SAMPLE.replace("20:58 ⇒ 21:46", "08:10 ⇒ 09:00");
  const result = buildYahooTravelImport(text, "Asia/Tokyo");
  assert.ok(result.ok);
  assert.equal(result.travel.departAt, "2026-08-27T23:10:00.000Z");
});

test("終電で到着が翌日になる", () => {
  const text = SAMPLE.replace("20:58 ⇒ 21:46", "23:50 ⇒ 00:20");
  const result = buildYahooTravelImport(text, "Asia/Tokyo");
  assert.ok(result.ok);
  assert.equal(result.travel.arriveAt, "2026-08-28T15:20:00.000Z");
});

test("時刻が読めなければ断る", () => {
  const result = buildYahooTravelImport("https://example.com/", "Asia/Tokyo");
  assert.ok(!result.ok);
  assert.equal(result.error, "unreadable");
});

test("検索日が無ければ今日へ置かず断る", () => {
  const result = buildYahooTravelImport(SAMPLE.replace("2026年8月28日(金)\n", ""), "Asia/Tokyo");
  assert.ok(!result.ok);
  assert.equal(result.error, "no_date");
});

test("駅名が読めなければ断る", () => {
  const text = SAMPLE.replace("草津(滋賀県) ⇒ 高槻\n", "").replace("■草津(滋賀県)", "").replace("■高槻", "");
  const result = buildYahooTravelImport(text, "Asia/Tokyo");
  assert.ok(!result.ok);
  assert.equal(result.error, "no_stations");
});
