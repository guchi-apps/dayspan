// 予定の「場所」欄の入力候補をClaudeに出させる（docs/spec.md §9）。
//
// portfolio の ai-project-summary.ts と同じく、`CLAUDE_CODE_OAUTH_TOKEN`（user:inferenceスコープ）で
// /v1/messages を直接呼ぶ。新しい依存を増やさずに済ませるため、SDKは使わない。
// 呼び出しごとにプラン枠を消費するため、呼び出し元は候補が無いときのボタン操作に限る。

const ANTHROPIC_API = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const OAUTH_BETA = "oauth-2025-04-20";

/** 生成に使うモデル。プラン枠の消費を抑えるため軽量なモデルを使う。 */
const MODEL = "claude-haiku-4-5";

/** 1回の呼び出しで出させる候補の最大件数 */
const MAX_SUGGESTIONS = 5;

/** 場所を推測する手がかりとして渡す、登録済みの場所の最大件数 */
const MAX_HINTS = 10;

export type PlaceSuggestion = {
  name: string;
  address: string | null;
};

export type PlaceSuggestInput = {
  /** 場所欄に入力中の文字列 */
  query: string;
  /** 予定のタイトル。場所の見当をつける手がかりになる。 */
  eventTitle?: string | null;
  /** 登録済みの場所（名前と住所）。よく行く範囲を推測させるために渡す。 */
  knownPlaces?: { name: string; address: string | null }[];
};

export function buildPlaceSuggestPrompt(input: PlaceSuggestInput): string {
  const hints = (input.knownPlaces ?? [])
    .slice(0, MAX_HINTS)
    .map((place) => `- ${place.name}${place.address ? `（${place.address}）` : ""}`)
    .join("\n");

  return `カレンダーアプリで予定を作っている人が、「場所」欄に次の文字列を入力しています。この人が入れようとしている場所の候補を挙げてください。

出力は前置きや説明・コードフェンスを一切付けず、以下の形式のJSONのみを出力してください。
{"places": [{"name": "場所の名前", "address": "住所またはnull"}]}

# 条件
- 候補は最大${MAX_SUGGESTIONS}件。確度の高いものから並べる
- name は予定表に書いてそのまま伝わる短い名前にする（施設名・店名・駅名など）
- address は分かる場合のみ入れる。確かでない住所は作らず null にする
- 入力が地名や施設名として意味をなさない場合は、places を空の配列にする
- 実在しない施設を創作しない

# 入力中の文字列
${input.query}

# 予定のタイトル
${input.eventTitle?.trim() || "(未入力)"}

# 登録済みの場所（この人がよく行く範囲の手がかり。同じ地域の候補を優先する）
${hints || "(なし)"}`;
}

type AnthropicMessageResponse = {
  content?: { type: string; text?: string }[];
};

function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

export async function suggestPlaces(
  token: string,
  input: PlaceSuggestInput,
): Promise<PlaceSuggestion[]> {
  const res = await fetch(`${ANTHROPIC_API}/v1/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": OAUTH_BETA,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildPlaceSuggestPrompt(input) }],
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Claudeでの場所の提案に失敗しました (${res.status})`);
  }

  const json = (await res.json()) as AnthropicMessageResponse;
  const text = json.content?.find((block) => block.type === "text")?.text?.trim();
  if (!text) {
    throw new Error("Claudeの応答からテキストを取得できませんでした");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(text));
  } catch {
    throw new Error("Claudeの応答をJSONとして解析できませんでした");
  }

  const places = (parsed as { places?: unknown })?.places;
  if (!Array.isArray(places)) {
    throw new Error("Claudeの応答の形式が不正です");
  }

  return places
    .filter((item): item is { name: string; address?: unknown } =>
      typeof item === "object" && item !== null && typeof (item as { name?: unknown }).name === "string",
    )
    .map((item) => ({
      name: item.name.trim(),
      address: typeof item.address === "string" && item.address.trim() ? item.address.trim() : null,
    }))
    .filter((place) => place.name)
    .slice(0, MAX_SUGGESTIONS);
}
