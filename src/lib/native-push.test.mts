import assert from "node:assert/strict";
import test from "node:test";

import { nativePushErrorMessage, parseNativePushStatus } from "@/lib/native-push";

test("想定外の返事は未決定・未登録として扱う", () => {
  assert.deepEqual(parseNativePushStatus(null), {
    permission: "notDetermined",
    registered: false,
    httpStatus: null,
    error: null,
  });
  assert.equal(parseNativePushStatus({ permission: "bogus" }).permission, "notDetermined");
});

test("登録済みの返事を読む", () => {
  const status = parseNativePushStatus({ permission: "granted", registered: true, httpStatus: 200 });
  assert.equal(status.registered, true);
  assert.equal(nativePushErrorMessage(status), null);
});

test("拒否・APNs未設定・アプリ側の失敗を文にする", () => {
  assert.match(
    nativePushErrorMessage(parseNativePushStatus({ permission: "denied" })) ?? "",
    /設定 > 通知/,
  );
  assert.match(
    nativePushErrorMessage(parseNativePushStatus({ permission: "granted", httpStatus: 503 })) ?? "",
    /APNs/,
  );
  assert.equal(
    nativePushErrorMessage(parseNativePushStatus({ permission: "granted", error: "timeout" })),
    "timeout",
  );
});
