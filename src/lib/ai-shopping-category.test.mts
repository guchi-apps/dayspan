import assert from "node:assert/strict";
import test from "node:test";

import {
  NO_MATCH_LABEL,
  buildShoppingCategoryQuestion,
  pickShoppingCategory,
  shouldAutoPickCategory,
} from "@/lib/ai-shopping-category";

const CATEGORIES = ["食品", "日用品", "飲料"];

test("質問はカテゴリ名をそのままラベルにし、逃げ道を1つ加える", () => {
  const question = buildShoppingCategoryQuestion(CATEGORIES);
  assert.equal(question.type, "choice");
  assert.deepEqual(Object.keys(question.criteria), [...CATEGORIES, NO_MATCH_LABEL]);
  assert.equal(question.criteria["食品"], null);
});

test("答えが一覧に含まれるときだけ採る", () => {
  assert.equal(pickShoppingCategory("日用品", CATEGORIES), "日用品");
  assert.equal(pickShoppingCategory("家電", CATEGORIES), null);
  assert.equal(pickShoppingCategory(NO_MATCH_LABEL, CATEGORIES), null);
  assert.equal(pickShoppingCategory(null, CATEGORIES), null);
  assert.equal(pickShoppingCategory("", CATEGORIES), null);
});

const base = { name: "牛乳", category: null, lastAskedName: null, categoryCount: 3, offline: false };

test("名前が入っていてカテゴリ未選択なら自動で判定する", () => {
  assert.equal(shouldAutoPickCategory(base), true);
});

test("選んであるカテゴリは上書きしない", () => {
  assert.equal(shouldAutoPickCategory({ ...base, category: "食品" }), false);
});

test("空の名前・同じ名前・カテゴリ0件・オフラインでは呼ばない", () => {
  assert.equal(shouldAutoPickCategory({ ...base, name: "  " }), false);
  assert.equal(shouldAutoPickCategory({ ...base, lastAskedName: "牛乳" }), false);
  assert.equal(shouldAutoPickCategory({ ...base, name: " 牛乳 ", lastAskedName: "牛乳" }), false);
  assert.equal(shouldAutoPickCategory({ ...base, categoryCount: 0 }), false);
  assert.equal(shouldAutoPickCategory({ ...base, offline: true }), false);
});

test("名前が変わっていれば呼び直す", () => {
  assert.equal(shouldAutoPickCategory({ ...base, name: "牛乳パック", lastAskedName: "牛乳" }), true);
});
