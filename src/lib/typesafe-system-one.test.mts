import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { setAiUsageRecorder } from "@/lib/anthropic-messages";
import { suggestShoppingCategory } from "@/lib/ai-shopping-category";
import type { AiUsageRecord } from "@/lib/ai-usage";

const input = { name: "牛乳", categories: ["食品", "日用品", "飲料"] };
const NONE = "（どれにも当てはまらない）";

const realFetch = globalThis.fetch;
const realKey = process.env.TYPESAFE_API_KEY;
const realBase = process.env.TYPESAFE_BASE_URL;

let recorded: AiUsageRecord[] = [];
let previousRecorder: ReturnType<typeof setAiUsageRecorder>;
type SentBody = { state: string; questions: { choice: { criteria: Record<string, unknown> } } };
let lastRequest: { url: string; auth: string | null; body: SentBody } | null = null;

function stubFetch(respond: () => Response) {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    lastRequest = {
      url: String(url),
      auth: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    };
    return respond();
  }) as typeof fetch;
}

function jev(choice: string) {
  return new Response(
    JSON.stringify({
      model: "jev-1.13.0",
      answers: { choice: { type: "choice", choice, confidence: 0.9 } },
      usage: { input_tokens: 42, output_tokens: 0 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  recorded = [];
  lastRequest = null;
  process.env.TYPESAFE_API_KEY = "test-key";
  process.env.TYPESAFE_BASE_URL = "https://jev.test";
  previousRecorder = setAiUsageRecorder(async (record) => {
    recorded.push(record);
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setAiUsageRecorder(previousRecorder);
  if (realKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = realKey;
  if (realBase === undefined) delete process.env.TYPESAFE_BASE_URL;
  else process.env.TYPESAFE_BASE_URL = realBase;
});

test("選ばれたカテゴリを返し、使用量を1行記録する", async () => {
  stubFetch(() => jev("飲料"));
  assert.deepEqual(await suggestShoppingCategory(input), { category: "飲料" });

  assert.equal(lastRequest?.url, "https://jev.test/v1/systemone");
  assert.equal(lastRequest?.auth, "Bearer test-key");
  assert.equal(lastRequest?.body.state, "牛乳");
  assert.deepEqual(Object.keys(lastRequest?.body.questions.choice.criteria), [...input.categories, NONE]);
  assert.deepEqual(recorded, [
    {
      feature: "shopping-category-suggest",
      model: "jev-1.13.0",
      inputTokens: 42,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
  ]);
});

test("逃げ道・一覧外の答えは合うカテゴリなし（失敗ではない）", async () => {
  stubFetch(() => jev(NONE));
  assert.deepEqual(await suggestShoppingCategory(input), { category: null });
  stubFetch(() => jev("家電"));
  assert.deepEqual(await suggestShoppingCategory(input), { category: null });
});

test("キー未設定・HTTPエラー・壊れた応答は失敗（null）で、HTTPエラーは記録しない", async () => {
  delete process.env.TYPESAFE_API_KEY;
  assert.equal(await suggestShoppingCategory(input), null);
  assert.equal(lastRequest, null);

  process.env.TYPESAFE_API_KEY = "test-key";
  stubFetch(() => new Response("x", { status: 500 }));
  assert.equal(await suggestShoppingCategory(input), null);
  stubFetch(() => new Response("not json", { status: 200 }));
  assert.equal(await suggestShoppingCategory(input), null);
  assert.equal(recorded.length, 0);
});
