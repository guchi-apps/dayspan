import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveRefreshedPropertyMap } from "@/services/notion/task-database";

const base = { title: "タイトル", due: "期限", done: "完了" };

test("変わらないときは null（更新しない）", () => {
  assert.equal(resolveRefreshedPropertyMap(base, { propertyMap: { ...base }, missingRequired: [] }), null);
});

test("プロパティが増えたときは新しい対応付けを返す", () => {
  const next = { ...base, outcome: "対応状況" };
  assert.deepEqual(resolveRefreshedPropertyMap(base, { propertyMap: next, missingRequired: [] }), next);
});

test("プロパティが消えた・改名されたときも反映する", () => {
  const next = { ...base, due: "締切" };
  assert.deepEqual(resolveRefreshedPropertyMap(base, { propertyMap: next, missingRequired: [] }), next);
});

test("必須プロパティが欠けたときは据え置く", () => {
  const missingRequired = [{ field: "due" as const, label: "期限", types: ["date"] }];
  assert.equal(resolveRefreshedPropertyMap(base, { propertyMap: { title: "タイトル" }, missingRequired }), null);
});

test("保存済みが無いときは初回として返す", () => {
  assert.deepEqual(resolveRefreshedPropertyMap(null, { propertyMap: base, missingRequired: [] }), base);
});
