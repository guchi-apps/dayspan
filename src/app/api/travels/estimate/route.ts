import { NextResponse } from "next/server";

import { estimateTravel } from "@/lib/ai-travel-estimate";
import { requireUserId } from "@/lib/auth-user";
import { isTravelMode, type TravelMode } from "@/types/calendar";

/**
 * 出発地から目的地までの所要時間をAIに見積もらせる（docs/spec.md §29）。
 *
 * 呼び出しごとにプラン枠を消費するため、画面側ではボタン操作からだけ呼ぶ。
 * 場所の「AIに聞く」（/api/places/suggest）と同じ扱い。
 *
 * 公共交通（電車・バス・飛行機）はYahoo!乗換案内からの取り込みへ移行済みで、この
 * エンドポイントは呼ばれない（旧trainroute経由の経路検索は issue #591 で撤去した）。
 */

type EstimateBody = {
  origin?: string;
  destination?: string;
  mode?: string;
};

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as EstimateBody;
  const origin = body.origin?.trim();
  const destination = body.destination?.trim();
  if (!origin || !destination) {
    return NextResponse.json(
      { error: "invalid_request", message: "出発地と目的地を入力してください。" },
      { status: 400 },
    );
  }

  const mode: TravelMode | null = isTravelMode(body.mode) ? body.mode : null;

  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error: "not_configured",
        message: "所要時間の見積もりが設定されていません（CLAUDE_CODE_OAUTH_TOKEN が未設定です）。",
      },
      { status: 503 },
    );
  }

  try {
    const estimates = await estimateTravel(token, { origin, destination, preferredMode: mode });
    return NextResponse.json({ estimates, attribution: null });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[dayspan] claude travel estimate failed:", detail);
    return NextResponse.json({ error: "ai_request_failed", message: detail }, { status: 502 });
  }
}
