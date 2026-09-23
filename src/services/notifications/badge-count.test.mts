import assert from "node:assert/strict";
import { test } from "node:test";

import { combineBadgeCounts, countDueShopping } from "@/services/notifications/badge-count";

const item = (over: Record<string, unknown>) =>
  ({ id: "x", name: "n", category: null, memo: null, priority: "medium", plannedDate: null, bought: false, url: null, ...over }) as never;

test("購入予定日が今日以前の未購入だけ数える", () => {
  const items = [
    item({ plannedDate: "2026-09-22" }),
    item({ plannedDate: "2026-09-23" }),
    item({ plannedDate: "2026-09-24" }),
    item({ plannedDate: null }),
    item({ plannedDate: "2026-09-20", bought: true }),
  ];
  assert.equal(countDueShopping(items, "2026-09-23"), 2);
});

test("片方が取れないと合計は null", () => {
  assert.deepEqual(combineBadgeCounts(3, 2), { tasks: 3, shopping: 2, total: 5 });
  assert.equal(combineBadgeCounts(3, null).total, null);
  assert.equal(combineBadgeCounts(null, 2).total, null);
});
