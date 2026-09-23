// TypeSafeのSystem Oneモデル（Jev）を呼ぶ入口（issue #725）。
//
// Jevは文章を書かず、渡した選択肢から1つと確率だけを返す（POST /v1/systemone）。候補に無い答えが
// 構造上返らないため、分類に向く。issue-deckの `src/lib/typesafe/system-one.ts` と同じ呼び方で、
// 公式SDKは依存を増やすだけなので使わず、生のfetchで呼ぶ。
// 失敗しても投げず null を返す（呼び出し元が手動選択のまま続けられるように）。

import { recordAiCall } from "@/lib/anthropic-messages";
import { extractUsageTokens, type AiFeature, type AnthropicUsage } from "@/lib/ai-usage";

const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const DEFAULT_MODEL = "jev-latest";

/** 判定は1秒未満で返るモデル。入力欄から離れた直後の自動呼び出しなので長くは待たない。 */
export const SYSTEM_ONE_TIMEOUT_MS = 8_000;

export type ChoiceQuestion = {
  type: "choice";
  instructions?: string;
  /** ラベル → 説明（説明が無ければ null） */
  criteria: Record<string, string | null>;
};

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};

type SystemOneResponse = {
  model?: unknown;
  answers?: Record<string, { type?: string; choice?: unknown } | undefined>;
  usage?: AnthropicUsage;
};

export function hasTypeSafeApiKey(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

function systemOneUrl(): string {
  // キーを持たない環境から経路だけを確かめるための差し替え口（公式SDKと同じ環境変数）。
  const base = process.env.TYPESAFE_BASE_URL?.trim().replace(/\/+$/, "") || DEFAULT_BASE_URL;
  return `${base}/v1/systemone`;
}

/** 選択肢を1つ選ばせる。キー未設定・通信失敗・応答不正は null。 */
export async function askChoice(options: {
  feature: AiFeature;
  state: string;
  question: ChoiceQuestion;
  timeoutMs?: number;
}): Promise<string | null> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) return null;

  let response: Response;
  try {
    response = await fetch(systemOneUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        state: options.state,
        questions: { choice: options.question },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? SYSTEM_ONE_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("[dayspan] typesafe request failed:", error instanceof Error ? error.message : error);
    return null;
  }

  if (!response.ok) {
    console.error(`[dayspan] typesafe request failed (${response.status})`);
    return null;
  }

  let json: SystemOneResponse;
  try {
    json = (await response.json()) as SystemOneResponse;
  } catch {
    return null;
  }
  if (!json || typeof json !== "object" || !json.answers) return null;

  // 応答が返った時点で数える。答えを読めなくても、呼び出しそのものは行われている。
  const model = typeof json.model === "string" && json.model.trim() ? json.model.trim() : DEFAULT_MODEL;
  await recordAiCall({ feature: options.feature, model, ...extractUsageTokens(json.usage) });

  const answer = json.answers.choice;
  if (!answer || answer.type !== "choice") return null;
  return typeof answer.choice === "string" && answer.choice ? answer.choice : null;
}
