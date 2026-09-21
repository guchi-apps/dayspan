import assert from "node:assert/strict";
import test from "node:test";

import type { AiUsageRecord } from "@/lib/ai-usage";
import { requestAnthropicMessage, setAiUsageRecorder } from "@/lib/anthropic-messages";

const REQUEST = {
  feature: "place-suggest",
  token: "token",
  model: "claude-haiku-4-5",
  maxTokens: 1024,
  prompt: "秘密のプロンプト本文",
  failureMessage: "失敗しました",
} as const;

/** `fetch` と記録先を差し替えて `fn` を動かす。差し替え忘れると開発DBへ行を書くため、必ずここを通す。 */
async function withStubs(
  respond: () => Response | Promise<Response>,
  fn: (records: AiUsageRecord[]) => Promise<void>,
  recorder?: (record: AiUsageRecord) => Promise<void>,
) {
  const records: AiUsageRecord[] = [];
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const previous = setAiUsageRecorder(
    recorder ??
      (async (record) => {
        records.push(record);
      }),
  );
  globalThis.fetch = (async () => respond()) as typeof fetch;
  console.error = () => {};
  try {
    await fn(records);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    setAiUsageRecorder(previous);
  }
}

const okBody = (extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text: " {\"places\": []} " }],
      usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 10, cache_creation_input_tokens: 4 },
      ...extra,
    }),
    { status: 200 },
  );

test("requestAnthropicMessage: 成功した応答を機能・モデル・トークン数で1行記録し、テキストを返す", async () => {
  await withStubs(okBody, async (records) => {
    const { text } = await requestAnthropicMessage(REQUEST);
    assert.equal(text, '{"places": []}');
    assert.deepEqual(records, [
      {
        feature: "place-suggest",
        // 応答が返した日付付きのIDを記録する
        model: "claude-haiku-4-5-20251001",
        inputTokens: 120,
        outputTokens: 30,
        cacheReadTokens: 10,
        cacheWriteTokens: 4,
      },
    ]);
  });
});

test("requestAnthropicMessage: 応答にモデルIDが無ければ要求したIDを記録する", async () => {
  await withStubs(
    () => okBody({ model: undefined }),
    async (records) => {
      await requestAnthropicMessage(REQUEST);
      assert.equal(records[0].model, "claude-haiku-4-5");
    },
  );
});

test("requestAnthropicMessage: 記録するのはトークン数だけで、プロンプトも応答本文も持たない", async () => {
  await withStubs(okBody, async (records) => {
    await requestAnthropicMessage(REQUEST);
    assert.deepEqual(Object.keys(records[0]).sort(), [
      "cacheReadTokens",
      "cacheWriteTokens",
      "feature",
      "inputTokens",
      "model",
      "outputTokens",
    ]);
    assert.ok(!JSON.stringify(records[0]).includes("秘密のプロンプト本文"));
  });
});

test("requestAnthropicMessage: HTTPエラーは数えずに投げる（usageが無く課金もされない）", async () => {
  await withStubs(
    () => new Response("overloaded", { status: 529 }),
    async (records) => {
      await assert.rejects(requestAnthropicMessage(REQUEST), /失敗しました \(529\)/);
      assert.deepEqual(records, []);
    },
  );
});

test("requestAnthropicMessage: 通信が届かなかった呼び出しも数えない", async () => {
  await withStubs(
    () => Promise.reject(new TypeError("fetch failed")),
    async (records) => {
      await assert.rejects(requestAnthropicMessage(REQUEST), /fetch failed/);
      assert.deepEqual(records, []);
    },
  );
});

test("requestAnthropicMessage: 記録に失敗してもAIの結果は返す", async () => {
  await withStubs(
    okBody,
    async () => {
      const { text } = await requestAnthropicMessage(REQUEST);
      assert.equal(text, '{"places": []}');
    },
    async () => {
      throw new Error("db down");
    },
  );
});

test("requestAnthropicMessage: テキストの無い応答もトークンは使っているので数える", async () => {
  await withStubs(
    () => okBody({ content: [] }),
    async (records) => {
      const { text } = await requestAnthropicMessage(REQUEST);
      assert.equal(text, undefined);
      assert.equal(records.length, 1);
    },
  );
});
