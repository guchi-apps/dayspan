import assert from "node:assert/strict";
import test from "node:test";

import { classifyTasks, sortDoneTasks } from "@/services/notion/task-buckets";
import type { TaskItem } from "@/types/calendar";

function makeTask(overrides: Partial<TaskItem> & { id: string }): TaskItem {
  return {
    kind: "task",
    title: overrides.id,
    due: null,
    hasTime: false,
    planned: null,
    plannedHasTime: false,
    done: false,
    skipped: false,
    canSkip: true,
    progress: null,
    canProgress: false,
    priority: null,
    tags: [],
    memo: null,
    recurrence: null,
    links: [],
    url: null,
    ...overrides,
  };
}

const dateKeyOf = (due: string) => due.slice(0, 10);

test("完了したタスクは done バケットへ、対応しないタスクは skipped バケットへ分かれる（issue #858）", () => {
  const done = makeTask({ id: "done", done: true, skipped: false });
  const skipped = makeTask({ id: "skipped", done: true, skipped: true });

  const buckets = classifyTasks([done, skipped], "2026-09-28", dateKeyOf);

  assert.deepEqual(buckets.done, [done]);
  assert.deepEqual(buckets.skipped, [skipped]);
});

test("未完了タスクは期限との比較で overdue/today/upcoming/someday に振り分けられる", () => {
  const overdue = makeTask({ id: "overdue", due: "2026-09-27" });
  const today = makeTask({ id: "today", due: "2026-09-28" });
  const upcoming = makeTask({ id: "upcoming", due: "2026-10-30" });
  const someday = makeTask({ id: "someday", due: null });

  const buckets = classifyTasks([overdue, today, upcoming, someday], "2026-09-28", dateKeyOf);

  assert.deepEqual(buckets.overdue, [overdue]);
  assert.deepEqual(buckets.today, [today]);
  assert.deepEqual(buckets.upcoming, [upcoming]);
  assert.deepEqual(buckets.someday, [someday]);
});

test("sortDoneTasks は skipped バケットにもそのまま使え、期限の新しい順に並ぶ", () => {
  const older = makeTask({ id: "older", done: true, skipped: true, due: "2026-09-01" });
  const newer = makeTask({ id: "newer", done: true, skipped: true, due: "2026-09-20" });

  assert.deepEqual(sortDoneTasks([older, newer]), [newer, older]);
});

test("期限は明日・今週・来週・今後に細分化される（2026-09-28は月曜・日曜始まり）（issue #903）", () => {
  const ids = ["2026-09-29", "2026-10-03", "2026-10-04", "2026-10-10", "2026-10-11"];
  const tasks = ids.map((due) => makeTask({ id: due, due }));

  const buckets = classifyTasks(tasks, "2026-09-28", dateKeyOf, "due", 0);

  assert.deepEqual(buckets.tomorrow.map((t) => t.id), ["2026-09-29"]);
  assert.deepEqual(buckets.thisWeek.map((t) => t.id), ["2026-10-03"]);
  assert.deepEqual(buckets.nextWeek.map((t) => t.id), ["2026-10-04", "2026-10-10"]);
  assert.deepEqual(buckets.upcoming.map((t) => t.id), ["2026-10-11"]);
});

test("週の開始曜日が月曜なら日曜は今週に入る", () => {
  const sunday = makeTask({ id: "sun", due: "2026-10-04" });
  const monday = makeTask({ id: "mon", due: "2026-10-05" });

  const buckets = classifyTasks([sunday, monday], "2026-09-28", dateKeyOf, "due", 1);

  assert.deepEqual(buckets.thisWeek, [sunday]);
  assert.deepEqual(buckets.nextWeek, [monday]);
});

test("明日が来週に当たる日でも明日は tomorrow に入る", () => {
  const tomorrow = makeTask({ id: "t", due: "2026-10-04" });

  // 2026-10-03は土曜、日曜始まりなので明日(日)は来週の頭。
  const buckets = classifyTasks([tomorrow], "2026-10-03", dateKeyOf, "due", 0);

  assert.deepEqual(buckets.tomorrow, [tomorrow]);
});

test("basis が planned なら予定日を優先し、無ければ期限で分類する（issue #903）", () => {
  const plannedSoon = makeTask({ id: "a", due: "2026-12-01", planned: "2026-09-28" });
  const plannedOnly = makeTask({ id: "b", planned: "2026-09-27" });
  const dueOnly = makeTask({ id: "c", due: "2026-09-29" });

  const buckets = classifyTasks([plannedSoon, plannedOnly, dueOnly], "2026-09-28", dateKeyOf, "planned");

  assert.deepEqual(buckets.today, [plannedSoon]);
  assert.deepEqual(buckets.overdue, [plannedOnly]);
  assert.deepEqual(buckets.tomorrow, [dueOnly]);

  const dueBasis = classifyTasks([plannedOnly], "2026-09-28", dateKeyOf, "due");
  assert.deepEqual(dueBasis.someday, [plannedOnly]);
});
