import assert from "node:assert/strict";
import test from "node:test";

import {
  EDIT_LOOKBACK_DAYS,
  MAX_RANGE_DAYS,
  planSleepHealthSync,
  sleepHealthEditSince,
  parseSleepHealthRange,
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

test("parseSleepHealthRange: from・to が無ければ通常の送信（範囲なし）", () => {
  assert.deepEqual(parseSleepHealthRange(null, null, { timeZone: TZ }), { ok: true, range: null });
  assert.deepEqual(parseSleepHealthRange("", " ", { timeZone: TZ }), { ok: true, range: null });
});

test("parseSleepHealthRange: 片方だけ・形式違い・存在しない日付・逆順は断る", () => {
  for (const [from, to] of [
    ["2026-09-01", null],
    [null, "2026-09-01"],
    ["2026/09/01", "2026-09-02"],
    ["2026-02-30", "2026-03-02"],
    ["2026-09-10", "2026-09-01"],
  ] as const) {
    const result = parseSleepHealthRange(from, to, { timeZone: TZ });
    assert.equal(result.ok, false, `${from} ${to}`);
  }
});

test("parseSleepHealthRange: 日数の上限（31日）を超えたら断る", () => {
  assert.equal(MAX_RANGE_DAYS, 31);
  assert.equal(parseSleepHealthRange("2026-08-01", "2026-08-31", { timeZone: TZ }).ok, true);
  assert.equal(parseSleepHealthRange("2026-08-01", "2026-09-01", { timeZone: TZ }).ok, false);
});

test("parseSleepHealthRange: 利用者のタイムゾーンで from の0:00〜to の翌0:00にする", () => {
  const result = parseSleepHealthRange("2026-09-18", "2026-09-18", { timeZone: TZ });
  assert.equal(result.ok, true);
  if (!result.ok || !result.range) return;

  assert.equal(result.range.after.toISOString(), "2026-09-17T15:00:00.000Z");
  assert.equal(result.range.before.toISOString(), "2026-09-18T15:00:00.000Z");
  assert.equal(result.range.from, "2026-09-18");
  assert.equal(result.range.to, "2026-09-18");
});

test("parseSleepHealthRange: 範囲で選んだ睡眠は起床した日で決まる（selectSleepForHealth と組み合わせる）", () => {
  const parsed = parseSleepHealthRange("2026-09-15", "2026-09-16", { timeZone: TZ });
  assert.equal(parsed.ok, true);
  if (!parsed.ok || !parsed.range) return;

  const items = selectSleepForHealth(
    [
      event("2026-09-13T14:00:00Z", "2026-09-13T21:00:00Z"), // 9/14 起床（範囲の前）
      event("2026-09-14T15:30:00Z", "2026-09-14T22:30:00Z"), // 9/15 起床
      event("2026-09-15T14:35:00Z", "2026-09-15T21:45:00Z"), // 9/16 起床
      event("2026-09-16T14:00:00Z", "2026-09-16T21:00:00Z"), // 9/17 起床（範囲の後）
    ],
    { title: "睡眠", after: parsed.range.after, now: parsed.range.before, timeZone: TZ },
  );

  assert.deepEqual(
    items.map((item) => item.end),
    ["2026-09-15T07:30:00+09:00", "2026-09-16T06:45:00+09:00"],
  );
});

// --- 送ったあとの変更（planSleepHealthSync） ---

function ev(id: string, start: string, end: string, extra: Record<string, unknown> = {}) {
  return { id, ...event(start, end, extra) };
}

function sentRecord(eventId: string, start: string, end: string) {
  return { eventId, start: new Date(start), end: new Date(end) };
}

const EDIT_SINCE = sleepHealthEditSince(NOW);
const PLAN_INPUT = {
  title: "睡眠",
  after: new Date("2026-09-18T21:45:00Z"), // 印（昨夜の睡眠の終わり）
  editSince: EDIT_SINCE,
  now: NOW,
  timeZone: TZ,
};

test("sleepHealthEditSince: 14日前", () => {
  assert.equal(EDIT_LOOKBACK_DAYS, 14);
  assert.equal(EDIT_SINCE.toISOString(), "2026-09-05T00:00:00.000Z");
});

test("planSleepHealthSync: 履歴が無く印より後に終わったものは送る（従来どおり）", () => {
  const plan = planSleepHealthSync(
    [ev("a", "2026-09-18T15:00:00Z", "2026-09-18T22:30:00Z")],
    [],
    PLAN_INPUT,
  );
  assert.deepEqual(plan.items.map((i) => i.eventId), ["a"]);
  assert.equal(plan.stale.length, 0);
});

test("planSleepHealthSync: 履歴が無く印以前に終わったもの（導入前に送った分）は何もしない", () => {
  const plan = planSleepHealthSync(
    [ev("a", "2026-09-17T14:00:00Z", "2026-09-17T21:00:00Z")],
    [],
    PLAN_INPUT,
  );
  assert.equal(plan.items.length, 0);
  assert.equal(plan.stale.length, 0);
});

test("planSleepHealthSync: 送った時刻と同じなら何もしない", () => {
  const plan = planSleepHealthSync(
    [ev("a", "2026-09-17T14:00:00Z", "2026-09-17T21:00:00Z")],
    [sentRecord("a", "2026-09-17T14:00:00Z", "2026-09-17T21:00:00Z")],
    PLAN_INPUT,
  );
  assert.equal(plan.items.length, 0);
  assert.equal(plan.stale.length, 0);
});

test("planSleepHealthSync: 終わりを後ろへ直したら変更後を送り、古い時間帯を消してもらう", () => {
  const plan = planSleepHealthSync(
    [ev("a", "2026-09-17T14:35:00Z", "2026-09-17T22:10:00Z")],
    [sentRecord("a", "2026-09-17T14:35:00Z", "2026-09-17T21:45:00Z")],
    PLAN_INPUT,
  );
  assert.deepEqual(
    plan.items.map(({ start, end }) => ({ start, end })),
    [{ start: "2026-09-17T23:35:00+09:00", end: "2026-09-18T07:10:00+09:00" }],
  );
  assert.deepEqual(
    plan.stale.map(({ start, end }) => ({ start, end })),
    [{ start: "2026-09-17T23:35:00+09:00", end: "2026-09-18T06:45:00+09:00" }],
  );
});

test("planSleepHealthSync: 印より前に終わる睡眠を入れ直しても変更として送る", () => {
  const plan = planSleepHealthSync(
    [ev("a", "2026-09-16T14:00:00Z", "2026-09-16T20:00:00Z")],
    [sentRecord("a", "2026-09-16T14:00:00Z", "2026-09-16T21:00:00Z")],
    PLAN_INPUT,
  );
  assert.equal(plan.items.length, 1);
  assert.equal(plan.stale.length, 1);
});

test("planSleepHealthSync: 予定を削除した・項目名を変えた・ヘルスケア由来にした睡眠は消してもらうだけ", () => {
  const sent = [
    sentRecord("deleted", "2026-09-14T14:00:00Z", "2026-09-14T21:00:00Z"),
    sentRecord("renamed", "2026-09-15T14:00:00Z", "2026-09-15T21:00:00Z"),
    sentRecord("imported", "2026-09-16T14:00:00Z", "2026-09-16T21:00:00Z"),
  ];
  const plan = planSleepHealthSync(
    [
      { ...ev("renamed", "2026-09-15T14:00:00Z", "2026-09-15T21:00:00Z"), summary: "昼寝" },
      ev("imported", "2026-09-16T14:00:00Z", "2026-09-16T21:00:00Z", {
        extendedProperties: { private: { dayspanSource: "health" } },
      }),
    ],
    sent,
    PLAN_INPUT,
  );
  assert.equal(plan.items.length, 0);
  assert.deepEqual(plan.stale.map((s) => s.eventId), ["deleted", "renamed", "imported"]);
});

test("planSleepHealthSync: 終日に変えた睡眠は消してもらう", () => {
  const plan = planSleepHealthSync(
    [{ id: "a", summary: "睡眠", start: { date: "2026-09-16" }, end: { date: "2026-09-17" } }],
    [sentRecord("a", "2026-09-16T14:00:00Z", "2026-09-16T21:00:00Z")],
    PLAN_INPUT,
  );
  assert.equal(plan.items.length, 0);
  assert.deepEqual(plan.stale.map((s) => s.eventId), ["a"]);
});

test("planSleepHealthSync: まだ終わっていない睡眠は履歴と比べない", () => {
  const plan = planSleepHealthSync(
    [ev("a", "2026-09-18T15:00:00Z", "2026-09-19T01:00:00Z")], // 終わりが now より後
    [sentRecord("a", "2026-09-18T15:00:00Z", "2026-09-18T22:00:00Z")],
    PLAN_INPUT,
  );
  assert.equal(plan.items.length, 0);
  assert.equal(plan.stale.length, 0);
});

test("planSleepHealthSync: 編集を探す範囲より前に終わった履歴は見ない", () => {
  const plan = planSleepHealthSync(
    [],
    [
      sentRecord("old", "2026-09-01T14:00:00Z", "2026-09-01T21:00:00Z"),
      sentRecord("edge", "2026-09-04T18:00:00Z", EDIT_SINCE.toISOString()), // ちょうど境目は範囲の外
      sentRecord("inside", "2026-09-05T14:00:00Z", "2026-09-05T21:00:00Z"),
    ],
    PLAN_INPUT,
  );
  assert.deepEqual(plan.stale.map((s) => s.eventId), ["inside"]);
});

test("planSleepHealthSync: id の無い予定は対象にしない", () => {
  const plan = planSleepHealthSync(
    [event("2026-09-18T15:00:00Z", "2026-09-18T22:30:00Z")],
    [],
    PLAN_INPUT,
  );
  assert.equal(plan.items.length, 0);
});

test("planSleepHealthSync: 送る分は終わった順、消す分は始まった順に並ぶ", () => {
  const plan = planSleepHealthSync(
    [
      ev("late", "2026-09-18T15:00:00Z", "2026-09-18T22:30:00Z"),
      ev("changed", "2026-09-16T14:00:00Z", "2026-09-16T20:00:00Z"),
    ],
    [
      sentRecord("changed", "2026-09-16T14:00:00Z", "2026-09-16T21:00:00Z"),
      sentRecord("gone", "2026-09-10T14:00:00Z", "2026-09-10T21:00:00Z"),
    ],
    PLAN_INPUT,
  );
  assert.deepEqual(plan.items.map((i) => i.eventId), ["changed", "late"]);
  assert.deepEqual(plan.stale.map((s) => s.eventId), ["gone", "changed"]);
});
