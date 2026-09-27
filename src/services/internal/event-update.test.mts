import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeInternalEventUpdate } from "@/services/internal/event-update";

const timed = {
  id: "a",
  summary: "歯医者",
  start: { dateTime: "2026-09-07T10:00:00+09:00" },
  end: { dateTime: "2026-09-07T11:00:00+09:00" },
};

test("時刻だけ送ると日付とタイトルは今のまま", () => {
  const r = mergeInternalEventUpdate(timed, { startTime: "14:00", endTime: "15:00" }, "Asia/Tokyo");
  assert.ok(r.ok);
  assert.equal(r.input.title, "歯医者");
  assert.equal(r.input.start, "2026-09-07T05:00:00.000Z");
});

test("日付だけ送ると時刻を保ったまま動く", () => {
  const r = mergeInternalEventUpdate(timed, { date: "2026-09-08" }, "Asia/Tokyo");
  assert.ok(r.ok);
  assert.equal(r.input.start, "2026-09-08T01:00:00.000Z");
  assert.equal(r.input.end, "2026-09-08T02:00:00.000Z");
});

test("片方だけの時刻・終了が開始以前は400", () => {
  const a = mergeInternalEventUpdate(timed, { startTime: "14:00" }, "Asia/Tokyo");
  assert.ok(!a.ok && a.status === 400);
  const b = mergeInternalEventUpdate(timed, { startTime: "14:00", endTime: "14:00" }, "Asia/Tokyo");
  assert.ok(!b.ok && b.status === 400);
});

test("繰り返しの親と日をまたぐ予定は409", () => {
  const a = mergeInternalEventUpdate({ ...timed, recurrence: ["RRULE:FREQ=WEEKLY"] }, { title: "x" }, "Asia/Tokyo");
  assert.ok(!a.ok && a.status === 409);
  const b = mergeInternalEventUpdate(
    { ...timed, end: { dateTime: "2026-09-08T01:00:00+09:00" } },
    { title: "x" },
    "Asia/Tokyo",
  );
  assert.ok(!b.ok && b.status === 409);
});

test("終日から時刻ありへは時刻が要る。終日への変更は date 形式", () => {
  const allDay = { id: "b", summary: "出張", start: { date: "2026-09-10" }, end: { date: "2026-09-11" } };
  const a = mergeInternalEventUpdate(allDay, { allDay: false }, "Asia/Tokyo");
  assert.ok(!a.ok && a.status === 400);
  const b = mergeInternalEventUpdate(allDay, { date: "2026-09-12" }, "Asia/Tokyo");
  assert.ok(b.ok && b.input.allDay && b.input.start === "2026-09-12");
  const c = mergeInternalEventUpdate(timed, { allDay: true }, "Asia/Tokyo");
  assert.ok(c.ok && c.input.allDay && c.input.start === "2026-09-07");
});
