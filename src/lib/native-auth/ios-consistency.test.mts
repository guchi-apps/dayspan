import assert from "node:assert/strict";
import test from "node:test";

import { checkConsistency } from "../../../ios/scripts/check-consistency.mjs";

test("iOSアプリの端末対応と、Swift・TS の認証・通知・連携設定が揃っている", () => {
  assert.deepEqual(checkConsistency(), []);
});
