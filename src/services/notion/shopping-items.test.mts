import assert from "node:assert/strict";
import test from "node:test";

import { normalizeShoppingPage } from "@/services/notion/shopping-items";

const map = { title: "項目", wishlisted: "ほしい物", bought: "購入済み" };

test("ほしい物のチェックを項目の所属として読む", () => {
  const item = normalizeShoppingPage(
    {
      id: "page-1",
      properties: {
        項目: { title: [{ plain_text: "イヤホン" }] },
        ほしい物: { checkbox: true },
        購入済み: { checkbox: false },
      },
    },
    map,
  );

  assert.equal(item?.wishlisted, true);
  assert.equal(item?.bought, false);
});

test("ほしい物プロパティを持たない既存DBの項目は通常の買い物になる", () => {
  const item = normalizeShoppingPage(
    { id: "page-1", properties: { 項目: { title: [{ plain_text: "牛乳" }] } } },
    { title: "項目" },
  );

  assert.equal(item?.wishlisted, false);
});
