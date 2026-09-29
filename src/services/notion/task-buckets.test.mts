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
  const upcoming = makeTask({ id: "upcoming", due: "2026-09-29" });
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
