import assert from "node:assert/strict";
import test from "node:test";

import { dropWebSubscriptionsCoveredByApp } from "@/services/notifications/delivery";

const subs = [
  { id: "a", label: "iPhone" },
  { id: "b", label: "Mac" },
  { id: "c", label: null },
  { id: "d", label: "iPad" },
];

test("アプリを登録している系統のWeb Pushだけを外す", () => {
  assert.deepEqual(
    dropWebSubscriptionsCoveredByApp(subs, ["iPhone"]).map((s) => s.id),
    ["b", "c", "d"],
  );
});

test("アプリの登録が無い・系統が不明なら何も外さない", () => {
  assert.equal(dropWebSubscriptionsCoveredByApp(subs, []).length, 4);
  assert.equal(dropWebSubscriptionsCoveredByApp(subs, [null]).length, 4);
});
