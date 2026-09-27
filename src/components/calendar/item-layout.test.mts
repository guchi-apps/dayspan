import assert from "node:assert/strict";
import test from "node:test";

import {
  taskOccurrenceCalendarDate,
  taskOccurrences,
  type TaskOccurrence,
} from "@/components/calendar/item-layout";
import type { TaskItem } from "@/types/calendar";

function task(overrides: Partial<TaskItem>): TaskItem {
  return {
    kind: "task",
    id: "task-1",
    title: "タスク",
    due: null,
    hasTime: false,
    planned: null,
    plannedHasTime: false,
    done: false,
    skipped: false,
    canSkip: false,
    priority: null,
    tags: [],
    memo: null,
    recurrence: null,
    links: [],
    url: null,
    ...overrides,
  };
}

function occurrence(field: TaskOccurrence["field"], date: string): TaskOccurrence {
  return { task: task({}), field, date, hasTime: date.includes("T"), key: `task-1:${field}` };
}

test("期限切れの期限だけを今日へ配置する", () => {
  const dateKey = (date: string) => date.slice(0, 10);

  assert.equal(
    taskOccurrenceCalendarDate(occurrence("due", "2026-09-25"), dateKey, "2026-09-27"),
    "2026-09-27",
  );
  assert.equal(
    taskOccurrenceCalendarDate(occurrence("planned", "2026-09-25"), dateKey, "2026-09-27"),
    "2026-09-25",
  );
  assert.equal(
    taskOccurrenceCalendarDate(occurrence("due", "2026-09-28"), dateKey, "2026-09-27"),
    "2026-09-28",
  );
});

test("月表示では移動後の配置日が同じ期限と予定日だけをまとめる", () => {
  const sameToday = task({ due: "2026-09-27", planned: "2026-09-27" });
  assert.equal(taskOccurrences(sameToday, (date) => date, "2026-09-27").length, 1);

  const dueOverdue = task({ due: "2026-09-25", planned: "2026-09-25" });
  assert.equal(taskOccurrences(dueOverdue, (date) => date, "2026-09-27").length, 2);
  assert.equal(taskOccurrences(dueOverdue, undefined, "2026-09-27").length, 2);
});
