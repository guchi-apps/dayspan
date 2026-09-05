// 出発地から目的地までの所要時間をClaudeに見積もらせる（docs/spec.md §29）。
//
// ai-place-suggest.ts と同じく、`CLAUDE_CODE_OAUTH_TOKEN`（user:inferenceスコープ）で
// /v1/messages を直接呼ぶ。新しい依存を増やさずに済ませるため、SDKは使わない。
//
// ここで出るのはあくまで目安で、時刻表や道路状況は見ていない。画面でもそう伝える。
// 呼び出しごとにプラン枠を消費するため、呼び出し元はボタン操作に限る。

import { TRAVEL_MODE_LABELS, TRAVEL_MODES, isTravelMode, type TravelMode } from "@/types/calendar";

const ANTHROPIC_API = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";
const OAUTH_BETA = "oauth-2025-04-20";

/** 生成に使うモデル。プラン枠の消費を抑えるため軽量なモデルを使う。 */
const MODEL = "claude-haiku-4-5";

/** 1回の呼び出しで出させる候補の最大件数。交通手段の数を超えても読み切れない。 */
const MAX_ESTIMATES = 4;

/** 見積もりとして受け付ける上限（分）。24時間を超える移動は入力の取り違えとみなす。 */
const MAX_MINUTES = 24 * 60;

/**
 * 所要時間の候補。
 *
 * AIの見積もりと、trainroute 経由で引いた経路検索の結果の両方をこの形で画面へ渡す。
 * 別々の型にすると、候補の一覧・押したときの処理を出どころの数だけ書くことになる。
 */
export type TravelEstimate = {
  mode: TravelMode;
  minutes: number;
  /** 経路の要点（利用路線・乗換回数など）。分からなければ null。 */
  detail: string | null;
  /** 出どころ。画面の注記と、保存する estimateSource をこれで決める。 */
  source: "ai" | "transit";
  /**
   * 経路検索のときだけ入る、その経路そのものの出発・到着時刻（ISO 8601）。
   * 到着時刻から分数を引く逆算より、返ってきた時刻をそのまま入れるほうが正確。
   */
  departAt?: string;
  arriveAt?: string;
  /**
   * 経路検索のときだけ入る内訳。渡した座標から想定と違う駅が選ばれていないかを
   * 画面で読めるようにするために持つ（出発地・目的地は駅とは限らないため）。
   */
  transit?: {
    transitCount: number;
    walkMinutes: number;
    boardStation: string | null;
    alightStation: string | null;
    fare: { ticket: number; ic: number | null } | null;
  };
};

export type TravelEstimateInput = {
  origin: string;
  destination: string;
  /** 利用者が選んでいる交通手段。先頭に置いて優先させる。 */
  preferredMode?: TravelMode | null;
};

export function buildTravelEstimatePrompt(input: TravelEstimateInput): string {
  const preferred = input.preferredMode
    ? TRAVEL_MODE_LABELS[input.preferredMode]
    : TRAVEL_MODE_LABELS.PUBLIC_TRANSIT;

  return `カレンダーアプリで移動の予定を作っている人が、出発地から目的地までの所要時間を知りたがっています。交通手段ごとの所要時間の目安を挙げてください。

出力は前置きや説明・コードフェンスを一切付けず、以下の形式のJSONのみを出力してください。
{"estimates": [{"mode": "CAR", "minutes": 40, "detail": "経路の要点またはnull"}]}

# 条件
- mode は次のいずれか: ${TRAVEL_MODES.join(", ")}
- 候補は最大${MAX_ESTIMATES}件。「${preferred}」を先頭に置き、そのあとに現実的な手段を並べる
- minutes は片道の所要時間を分で表した整数。待ち時間・乗換時間を含めたドアツードアの目安にする
- detail は利用路線や乗換回数など、目安の根拠になる短い一文。分からない場合は null にする
- 出発地・目的地が特定できない場合は estimates を空の配列にする
- 実在しない路線・施設を創作しない

# 出発地
${input.origin}

# 目的地
${input.destination}`;
}

type AnthropicMessageResponse = {
  content?: { type: string; text?: string }[];
};

function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

export async function estimateTravel(
  token: string,
  input: TravelEstimateInput,
): Promise<TravelEstimate[]> {
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
      messages: [{ role: "user", content: buildTravelEstimatePrompt(input) }],
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Claudeでの所要時間の見積もりに失敗しました (${res.status})`);
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

  const estimates = (parsed as { estimates?: unknown })?.estimates;
  if (!Array.isArray(estimates)) {
    throw new Error("Claudeの応答の形式が不正です");
  }

  const seen = new Set<TravelMode>();

  return estimates
    .filter(
      (item): item is { mode: string; minutes: number; detail?: unknown } =>
        typeof item === "object" &&
        item !== null &&
        isTravelMode((item as { mode?: unknown }).mode) &&
        Number.isFinite((item as { minutes?: unknown }).minutes),
    )
    .map((item): TravelEstimate => ({
      mode: item.mode as TravelMode,
      minutes: Math.round(item.minutes),
      detail: typeof item.detail === "string" && item.detail.trim() ? item.detail.trim() : null,
      source: "ai",
    }))
    .filter((estimate) => {
      // 同じ手段が2件出ると、どちらを選べばよいか決まらない。先に出たほうを採る。
      if (estimate.minutes < 1 || estimate.minutes > MAX_MINUTES) return false;
      if (seen.has(estimate.mode)) return false;
      seen.add(estimate.mode);
      return true;
    })
    .slice(0, MAX_ESTIMATES);
}
