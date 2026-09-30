import assert from "node:assert/strict";
import { test } from "node:test";

import { isActivityIconKey, resolveActivityIcon } from "@/lib/activity-icons";

test("保存済みのキーを優先する", () => {
  assert.equal(resolveActivityIcon("睡眠", "sun"), "sun");
});

test("未設定なら初期項目は名前から既定を引く", () => {
  assert.equal(resolveActivityIcon("睡眠", null), "moon");
  assert.equal(resolveActivityIcon("仕事", undefined), "laptop");
});

test("知らない名前・不正なキーは null（または既定）へ落ちる", () => {
  assert.equal(resolveActivityIcon("読書", null), null);
  assert.equal(resolveActivityIcon("読書", "nope"), null);
  assert.equal(resolveActivityIcon("睡眠", "nope"), "moon");
  assert.equal(resolveActivityIcon("toString", null), null);
});

test("他の種類の印と同じ図柄は選べない", () => {
  for (const key of ["car", "train", "briefcase", "cart", "trash", "toString"]) {
    assert.equal(isActivityIconKey(key), false);
  }
});
