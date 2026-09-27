import assert from "node:assert/strict";
import test from "node:test";

import { buildShoppingPropertyMap } from "@/services/notion/shopping-database";
import { normalizeShoppingPage } from "@/services/notion/shopping-items";

const map = { title: "項目", wishlisted: "ほしい物", bought: "購入済み" };

test("旧「ほしい物」のチェックを欲しいものの所属として読む", () => {
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

test("欲しいものプロパティを持たない既存DBの項目は買うものになる", () => {
  const item = normalizeShoppingPage(
    { id: "page-1", properties: { 項目: { title: [{ plain_text: "牛乳" }] } } },
    { title: "項目" },
  );

  assert.equal(item?.wishlisted, false);
});

test("旧表記と新表記の欲しいものプロパティをどちらも対応付ける", () => {
  for (const name of ["ほしい物", "欲しいもの"]) {
    const validation = buildShoppingPropertyMap({
      項目: { id: "title", name: "項目", type: "title" },
      [name]: { id: "wishlist", name, type: "checkbox" },
      購入済み: { id: "bought", name: "購入済み", type: "checkbox" },
    });
    assert.equal(validation.propertyMap.wishlisted, name);
  }
});
