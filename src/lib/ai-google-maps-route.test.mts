import assert from "node:assert/strict";
import test from "node:test";

import { analyzeGoogleMapsRoute, buildGoogleMapsRouteAnalysisPrompt } from "@/lib/ai-google-maps-route";
import { setAiUsageRecorder } from "@/lib/anthropic-messages";

const INPUT = {
  origin: "大阪駅",
  destination: "新大阪駅",
  mode: "CAR" as const,
  url: "https://www.google.com/maps/dir/大阪駅/新大阪駅",
};

test("Googleマップ経路の構造化情報をAI解析プロンプトへ渡す", () => {
  const prompt = buildGoogleMapsRouteAnalysisPrompt(INPUT);
  assert.match(prompt, /出発地: 大阪駅/);
  assert.match(prompt, /目的地: 新大阪駅/);
  assert.match(prompt, /共有URL: https:\/\/www\.google\.com/);
});

test("AIの有効な経路解析結果を受け入れる", async () => {
  const previousFetch = globalThis.fetch;
  const previousRecorder = setAiUsageRecorder(async () => {});
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ content: [{ type: "text", text: '{"origin":"大阪駅","destination":"新大阪駅","mode":"CAR","minutes":12}' }] }));

  try {
    assert.deepEqual(await analyzeGoogleMapsRoute("token", INPUT), {
      origin: "大阪駅",
      destination: "新大阪駅",
      mode: "CAR",
      minutes: 12,
    });
  } finally {
    globalThis.fetch = previousFetch;
    setAiUsageRecorder(previousRecorder);
  }
});

test("AIの不正な所要時間は受け入れない", async () => {
  const previousFetch = globalThis.fetch;
  const previousRecorder = setAiUsageRecorder(async () => {});
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ content: [{ type: "text", text: '{"origin":"大阪駅","destination":"新大阪駅","mode":"CAR","minutes":0}' }] }));

  try {
    await assert.rejects(() => analyzeGoogleMapsRoute("token", INPUT), /所要時間が不正/);
  } finally {
    globalThis.fetch = previousFetch;
    setAiUsageRecorder(previousRecorder);
  }
});
