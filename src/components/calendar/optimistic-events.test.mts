import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOptimisticEvents,
  buildOptimisticEvent,
  pendingOptimisticOps,
  rangesWithin,
  type OptimisticEventOp,
} from "@/components/calendar/optimistic-events";
import type { CalendarEventItem, WritableCalendar } from "@/types/calendar";

const CALENDARS: WritableCalendar[] = [
  { calendarId: "main", name: "メイン", color: "#039be5", isCreateDefault: true },
  { calendarId: "work", name: "仕事", color: "#d50000", isCreateDefault: false },
];

function event(id: string, calendarId = "main", title = id): CalendarEventItem {
  return buildOptimisticEvent(
    {
      calendarId,
      title,
      allDay: false,
      start: "2026-09-25T01:00:00.000Z",
      end: "2026-09-25T02:00:00.000Z",
    },
    id,
    CALENDARS,
  );
}

test("重ねる操作が無ければ同じ配列を返す", () => {
  const events = [event("a")];
  assert.equal(applyOptimisticEvents(events, []), events);
});

test("新しく作った予定を足す", () => {
  const result = applyOptimisticEvents([event("a")], [
    { type: "upsert", item: event("b"), ranges: [] },
  ]);
  assert.deepEqual(
    result.map((item) => item.id),
    ["a", "b"],
  );
});

test("取り直しの結果に同じ予定があっても2件にしない", () => {
  const result = applyOptimisticEvents([event("a", "main", "旧")], [
    { type: "upsert", item: event("a", "main", "新"), ranges: [] },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "新");
});

test("カレンダーを移した予定は移動元を消す", () => {
  const result = applyOptimisticEvents([event("a", "main")], [
    {
      type: "upsert",
      item: event("a", "work"),
      previous: { calendarId: "main", id: "a" },
      ranges: [],
    },
  ]);
  assert.deepEqual(
    result.map((item) => `${item.calendarId}/${item.id}`),
    ["work/a"],
  );
});

test("別のカレンダーの同じIDは消さない", () => {
  const result = applyOptimisticEvents([event("a", "main"), event("a", "work")], [
    { type: "remove", target: { calendarId: "work", id: "a" }, ranges: [] },
  ]);
  assert.deepEqual(
    result.map((item) => item.calendarId),
    ["main"],
  );
});

test("同じ予定への操作は後のものが勝つ", () => {
  const result = applyOptimisticEvents([], [
    { type: "upsert", item: event("a", "main", "1回目"), ranges: [] },
    { type: "upsert", item: event("a", "main", "2回目"), ranges: [] },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "2回目");

  const removed = applyOptimisticEvents([], [
    { type: "upsert", item: event("a"), ranges: [] },
    { type: "remove", target: { calendarId: "main", id: "a" }, ranges: [] },
  ]);
  assert.equal(removed.length, 0);
});

test("保存後に取り直せた操作だけを外す", () => {
  const ops: OptimisticEventOp[] = [
    { type: "upsert", item: event("a"), ranges: [{ start: "2026-09-25", end: "2026-09-25" }], seq: 1, savedAt: 100 },
    { type: "upsert", item: event("b"), ranges: [{ start: "2026-10-01", end: "2026-10-01" }], seq: 2, savedAt: 100 },
  ];
  // 9月は保存後（200）に取り直せた。10月は保存前（50）に取ったきり。
  const syncedAt: Record<string, number> = { "2026-09": 200, "2026-10": 50 };
  const pending = pendingOptimisticOps(ops, (ranges, since) =>
    ranges.every((range) => (syncedAt[range.start.slice(0, 7)] ?? 0) >= since),
  );
  assert.deepEqual(
    pending.map((op) => op.seq),
    [2],
  );
});

test("取得範囲に収まるかは日付で比べる", () => {
  assert.equal(rangesWithin([{ start: "2026-09-25", end: "2026-09-26" }], "2026-09-24", "2026-09-30"), true);
  assert.equal(
    rangesWithin([{ start: "2026-09-30T23:00:00.000Z", end: "2026-10-01T01:00:00.000Z" }], "2026-09-24", "2026-09-30"),
    false,
  );
  assert.equal(rangesWithin([{ start: "2026-09-23", end: "2026-09-25" }], "2026-09-24", "2026-09-30"), false);
});

test("組み立てた予定は保存先の名前と色を持ち、空のタイトルはGoogleと同じ表記にする", () => {
  const item = buildOptimisticEvent(
    { calendarId: "work", title: "  ", allDay: true, start: "2026-09-25", end: "2026-09-26", tentative: true },
    "x",
    CALENDARS,
  );
  assert.equal(item.calendarName, "仕事");
  assert.equal(item.color, "#d50000");
  assert.equal(item.title, "(タイトルなし)");
  assert.equal(item.tentative, true);
  assert.equal(item.readOnly, false);
  assert.equal(item.outcome, null);
});

test("編集元の予定から、送っていない項目を引き継ぐ", () => {
  const base: CalendarEventItem = {
    ...event("a"),
    location: "渋谷",
    description: "メモ",
    attendees: ["a@example.com"],
    recurring: true,
    tentative: true,
    url: "https://calendar.google.com/x",
    outcome: { kind: "CANCELED", note: null },
  } as CalendarEventItem;

  // ドラッグは時刻とタイトルしか送らない。
  const moved = buildOptimisticEvent(
    { calendarId: "main", title: "a", allDay: false, start: "2026-09-26T01:00:00.000Z", end: "2026-09-26T02:00:00.000Z" },
    "a",
    CALENDARS,
    base,
  );
  assert.equal(moved.location, "渋谷");
  assert.equal(moved.description, "メモ");
  assert.equal(moved.tentative, true);
  assert.equal(moved.recurring, true);
  assert.deepEqual(moved.attendees, ["a@example.com"]);
  assert.equal(moved.url, base.url);
  assert.deepEqual(moved.outcome, base.outcome);
  assert.equal(moved.start, "2026-09-26T01:00:00.000Z");

  // フォームは空欄を null で送る。空にした値は引き継がない。
  const cleared = buildOptimisticEvent(
    { calendarId: "main", title: "a", allDay: false, start: base.start, end: base.end, location: null, description: null, tentative: false },
    "a",
    CALENDARS,
    base,
  );
  assert.equal(cleared.location, null);
  assert.equal(cleared.description, null);
  assert.equal(cleared.tentative, false);
});
