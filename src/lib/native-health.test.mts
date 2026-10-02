import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nativeHealthSummary, parseNativeHealthResult } from "@/lib/native-health";

describe("parseNativeHealthResult", () => {
  it("想定外の形は何も送れていない扱いにする", () => {
    const result = parseNativeHealthResult(null);
    assert.deepEqual(result, {
      permission: "notDetermined",
      sent: 0,
      removed: 0,
      staleLeft: [],
      error: null,
    });
  });

  it("件数は負・小数・文字列を安全な整数へ寄せ、不正な時間帯は捨てる", () => {
    const result = parseNativeHealthResult({
      permission: "granted",
      sent: 2.9,
      removed: -1,
      staleLeft: [{ start: "a", end: "b" }, { start: 1 }, null],
    });
    assert.equal(result.sent, 2);
    assert.equal(result.removed, 0);
    assert.deepEqual(result.staleLeft, [{ start: "a", end: "b" }]);
  });
});

describe("nativeHealthSummary", () => {
  const base = parseNativeHealthResult({ permission: "granted" });

  it("送るものが無いとき", () => {
    assert.equal(nativeHealthSummary(base, "睡眠"), "ヘルスケアへ送る睡眠はありません。");
  });

  it("送った件数と消した件数を並べる", () => {
    const text = nativeHealthSummary({ ...base, sent: 2, removed: 1 }, "睡眠");
    assert.match(text, /睡眠を2件/);
    assert.match(text, /1件消しました/);
  });

  it("拒否・エラーは理由を優先する", () => {
    assert.match(nativeHealthSummary({ ...base, permission: "denied" }, "睡眠"), /許可/);
    assert.equal(nativeHealthSummary({ ...base, error: "失敗" }, "睡眠"), "失敗");
  });
});
