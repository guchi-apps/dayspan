import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_FEATURES,
  AI_FEATURE_LABELS,
  buildAiUsageResponse,
  extractUsageTokens,
  featureLabel,
  type AiUsageGroup,
} from "@/lib/ai-usage";

function group(overrides: Partial<AiUsageGroup> = {}): AiUsageGroup {
  return {
    feature: "place-suggest",
    model: "claude-haiku-4-5",
    calls: 1,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...overrides,
  };
}

const TOTAL_FIELDS = ["calls", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"];

/** ops-dashboard の `parseAiAppUsageResponse` が通す形（負でない安全な整数・空でない文字列）。 */
function assertAcceptedByOpsDashboard(data: unknown) {
  const features = (data as { features: unknown }).features;
  assert.ok(Array.isArray(features));
  for (const row of features as Record<string, unknown>[]) {
    assert.ok(typeof row.label === "string" && row.label.length > 0);
    assert.ok(typeof row.model === "string" && row.model.length > 0);
    for (const key of ["last24h", "last7d"]) {
      const totals = row[key] as Record<string, unknown>;
      for (const field of TOTAL_FIELDS) {
        const value = totals[field];
        assert.ok(
          typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
          `${key}.${field} must be a non-negative integer`,
        );
      }
    }
  }
}

test("extractUsageTokens: キャッシュを入力へ足さず、応答の項目をそのまま対応させる", () => {
  assert.deepEqual(
    extractUsageTokens({
      input_tokens: 1200,
      output_tokens: 340,
      cache_read_input_tokens: 50,
      cache_creation_input_tokens: 7,
    }),
    { inputTokens: 1200, outputTokens: 340, cacheReadTokens: 50, cacheWriteTokens: 7 },
  );
});

test("extractUsageTokens: 欠けた・壊れた項目は行ごと捨てず0として数える", () => {
  const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  assert.deepEqual(extractUsageTokens(undefined), zero);
  assert.deepEqual(extractUsageTokens(null), zero);
  assert.deepEqual(
    extractUsageTokens({ input_tokens: "12", output_tokens: -5, cache_read_input_tokens: 1.5 }),
    zero,
  );
  assert.deepEqual(extractUsageTokens({ output_tokens: 8 }), { ...zero, outputTokens: 8 });
});

test("featureLabel: 全ての機能に表示名があり、コードから消えた識別子はそのまま出す", () => {
  for (const feature of AI_FEATURES) {
    assert.ok(AI_FEATURE_LABELS[feature].length > 0);
    assert.equal(featureLabel(feature), AI_FEATURE_LABELS[feature]);
  }
  assert.equal(featureLabel("legacy-feature"), "legacy-feature");
});

test("buildAiUsageResponse: 呼び出しが無ければ空の配列（エラーにしない）", () => {
  assert.deepEqual(buildAiUsageResponse([], []), { features: [] });
});

test("buildAiUsageResponse: 同じ機能×モデルの24時間・7日間を1行にまとめる", () => {
  const result = buildAiUsageResponse(
    [group({ calls: 2, inputTokens: 300, outputTokens: 30, cacheReadTokens: 5, cacheWriteTokens: 1 })],
    [group({ calls: 9, inputTokens: 1500, outputTokens: 150, cacheReadTokens: 20, cacheWriteTokens: 4 })],
  );

  assert.deepEqual(result, {
    features: [
      {
        label: "場所の候補の提案",
        model: "claude-haiku-4-5",
        last24h: { calls: 2, inputTokens: 300, outputTokens: 30, cacheReadTokens: 5, cacheWriteTokens: 1 },
        last7d: { calls: 9, inputTokens: 1500, outputTokens: 150, cacheReadTokens: 20, cacheWriteTokens: 4 },
      },
    ],
  });
});

test("buildAiUsageResponse: 呼び出しが1日より前だけの行は24時間側を0で埋める", () => {
  const result = buildAiUsageResponse([], [group({ calls: 4, inputTokens: 800, outputTokens: 80 })]);

  assert.equal(result.features.length, 1);
  assert.deepEqual(result.features[0].last24h, {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  assert.equal(result.features[0].last7d.calls, 4);
  assertAcceptedByOpsDashboard(result);
});

test("buildAiUsageResponse: 7日間側に行が無ければ24時間側を使う（矛盾する0を返さない）", () => {
  const result = buildAiUsageResponse([group({ calls: 3, inputTokens: 500 })], []);
  assert.equal(result.features[0].last7d.calls, 3);
  assert.equal(result.features[0].last7d.inputTokens, 500);
});

test("buildAiUsageResponse: モデルを切り替えた機能はモデルごとの2行にする", () => {
  const result = buildAiUsageResponse(
    [group({ model: "claude-haiku-4-5" })],
    [group({ model: "claude-haiku-4-5", calls: 5 }), group({ model: "claude-sonnet-5", calls: 7 })],
  );

  assert.deepEqual(
    result.features.map((row) => [row.label, row.model, row.last24h.calls, row.last7d.calls]),
    [
      ["場所の候補の提案", "claude-haiku-4-5", 1, 5],
      ["場所の候補の提案", "claude-sonnet-5", 0, 7],
    ],
  );
});

test("buildAiUsageResponse: 入力の並びによらず行の順が変わらない", () => {
  const a = group({ feature: "travel-estimate" });
  const b = group({ feature: "place-suggest", model: "claude-sonnet-5" });
  const c = group({ feature: "place-suggest" });

  assert.deepEqual(buildAiUsageResponse([], [a, b, c]), buildAiUsageResponse([], [c, a, b]));
});

test("buildAiUsageResponse: 負・小数などの値が混ざっても、応答は負でない整数だけにする", () => {
  const result = buildAiUsageResponse([], [group({ calls: 2.5, inputTokens: -1, outputTokens: Number.NaN })]);
  assertAcceptedByOpsDashboard(result);
});

test("buildAiUsageResponse: 返すのは回数とトークン数だけ", () => {
  const result = buildAiUsageResponse([group()], [group()]);
  assert.deepEqual(Object.keys(result), ["features"]);
  assert.deepEqual(Object.keys(result.features[0]).sort(), ["label", "last24h", "last7d", "model"]);
  assert.deepEqual(Object.keys(result.features[0].last24h).sort(), [...TOTAL_FIELDS].sort());
});
