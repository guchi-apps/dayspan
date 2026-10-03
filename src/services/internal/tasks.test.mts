import assert from "node:assert/strict";
import test from "node:test";

import {
  InternalTaskInputError,
  parseInternalTaskWrite,
  parseTaskAction,
} from "@/services/internal/task-contract";

test("内部タスク更新は許可外のプロパティを拒否する", () => {
  assert.throws(() => parseInternalTaskWrite({ title: "x", arbitrary: "value" }), InternalTaskInputError);
});

test("内部タスク作成はタイトルと正しい日付だけを受け付ける", () => {
  assert.deepEqual(parseInternalTaskWrite({ title: "  タスク  ", due: "2026-10-04" }, { create: true }), {
    title: "タスク",
    due: "2026-10-04",
  });
  assert.throws(() => parseInternalTaskWrite({ title: "x", due: "2026-02-30" }, { create: true }), InternalTaskInputError);
});

test("状態遷移は列挙値に限定する", () => {
  assert.equal(parseTaskAction("complete"), "complete");
  assert.throws(() => parseTaskAction("done"), InternalTaskInputError);
});
