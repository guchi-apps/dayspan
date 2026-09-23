// Anthropic の /v1/messages を呼ぶ共通部分（issue #680）。
//
// `ai-place-suggest.ts` と `ai-travel-estimate.ts` が同じ呼び方を写しで持っていたため、
// AIの使用量を記録する場所を1か所にするためにここへ集めた。呼び出し元は `feature` を必ず渡す
// （型で漏れない）。`CLAUDE_CODE_OAUTH_TOKEN`（user:inferenceスコープ）で直接呼ぶ点、
// 新しい依存を増やさずSDKを使わない点は従来のまま。
//
// 記録するのは回数とトークン数だけで、プロンプト本文・応答・入力した文字列は持たない。

import {
  extractUsageTokens,
  type AiFeature,
  type AiUsageRecord,
  type AnthropicUsage,
} from "@/lib/ai-usage";

const ANTHROPIC_API = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const OAUTH_BETA = "oauth-2025-04-20";

type AnthropicMessageResponse = {
  content?: { type: string; text?: string }[];
  /** 応答が返したモデルID。日付付き（`claude-haiku-4-5-20251001`）のことがある。 */
  model?: unknown;
  usage?: AnthropicUsage;
};

export type AiUsageRecorder = (record: AiUsageRecord) => Promise<void>;

// 既定の記録先はDB。`@/lib/db` はここで読み込まず呼ばれた時に読む（テストでPrismaを持ち込まないため）。
// テストは `setAiUsageRecorder` で差し替える。差し替え忘れると、`fetch` をスタブしたテストが開発DBへ行を書く。
let recorder: AiUsageRecorder = async (record) => {
  const { saveAiUsage } = await import("@/lib/ai-usage-log");
  await saveAiUsage(record);
};

/** テスト用。記録先を差し替え、元の記録先を返す。 */
export function setAiUsageRecorder(next: AiUsageRecorder): AiUsageRecorder {
  const previous = recorder;
  recorder = next;
  return previous;
}

/**
 * 記録に失敗しても投げない。すでに課金された結果を、記録できなかっただけで捨てないため。
 * 失敗はサーバーログに残る（このとき使用量が実際より少なく出る）。
 */
async function recordUsage(feature: AiFeature, requestedModel: string, json: AnthropicMessageResponse) {
  try {
    const model = typeof json.model === "string" && json.model.trim() ? json.model.trim() : requestedModel;
    await recorder({ feature, model, ...extractUsageTokens(json.usage) });
  } catch (error) {
    console.error("[dayspan] AI usage log failed:", error instanceof Error ? error.message : error);
  }
}

/** Anthropic以外（TypeSafeのJev）の呼び出しも同じ記録先へ足す。失敗しても投げない。 */
export async function recordAiCall(record: AiUsageRecord): Promise<void> {
  try {
    await recorder(record);
  } catch (error) {
    console.error("[dayspan] AI usage log failed:", error instanceof Error ? error.message : error);
  }
}

export type AnthropicMessageRequest = {
  /** 使用量を集計する機能。`ai-usage.ts` の `AI_FEATURES` から選ぶ。 */
  feature: AiFeature;
  token: string;
  model: string;
  maxTokens: number;
  prompt: string;
  /** HTTPエラーのときに投げるメッセージの頭。ステータスコードを `(status)` として後ろへ足す。 */
  failureMessage: string;
};

/**
 * 1回のメッセージを送り、応答の最初のテキストを返す（無ければ `text` は undefined）。
 *
 * - HTTPエラー・通信不達には `usage` が無く課金もされない前提のため、記録せずに投げる
 * - 応答が返った時点で記録する。応答の中身が後で解析できなくても、トークンは使っているため数える
 */
export async function requestAnthropicMessage(
  request: AnthropicMessageRequest,
): Promise<{ text: string | undefined }> {
  const res = await fetch(`${ANTHROPIC_API}/v1/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${request.token}`,
      "anthropic-beta": OAUTH_BETA,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.maxTokens,
      messages: [{ role: "user", content: request.prompt }],
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`${request.failureMessage} (${res.status})`);
  }

  const json = (await res.json()) as AnthropicMessageResponse;
  await recordUsage(request.feature, request.model, json);

  return { text: json.content?.find((block) => block.type === "text")?.text?.trim() };
}
