import { NextResponse } from "next/server";

import { estimateTravel } from "@/lib/ai-travel-estimate";
import { requireUserId } from "@/lib/auth-user";
import type { TransitQuota } from "@/lib/transit-quota";
import { TRANSIT_ESTIMATE_ENABLED, fetchTransitQuota } from "@/services/trainroute/client";
import { isTravelMode } from "@/types/calendar";

/**
 * 出発地から目的地までの所要時間をAIに見積もらせる（docs/spec.md §29）。
 *
 * 呼び出しごとにプラン枠を消費するため、画面側ではボタン操作からだけ呼ぶ。
 * 場所の「AIに聞く」（/api/places/suggest）と同じ扱い。
 *
 * 経路検索（NAVITIME）の残り回数も一緒に返す。残り回数のためだけに往復を1つ増やさないため。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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

  const body = (await request.json()) as { origin?: string; destination?: string; mode?: string };
  const origin = body.origin?.trim();
  const destination = body.destination?.trim();
  if (!origin || !destination) {
    return NextResponse.json(
      { error: "invalid_request", message: "出発地と目的地を入力してください。" },
      { status: 400 },
    );
  }

  try {
    const estimates = await estimateTravel(token, {
      origin,
      destination,
      preferredMode: isTravelMode(body.mode) ? body.mode : null,
    });
    return NextResponse.json({ estimates, transit: await loadTransitQuotas() });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[dayspan] claude travel estimate failed:", detail);
    return NextResponse.json({ error: "ai_request_failed", message: detail }, { status: 502 });
  }
}

/**
 * 入力画面に添える経路検索の利用枠。
 *
 * DaySpanが経路検索を使うようになるまでは返さない（`TRANSIT_ESTIMATE_ENABLED`）。
 * 使っていないのに「電車はNAVITIMEの経路検索を使います」と出すと、実際にはAIの目安が
 * 出ているのに実データが出るかのように読める。設定 ▸ 移動の区画はこの判定を通さない
 * （trainroute側が既に使った分を見るのが目的のため）。
 *
 * 複数の提供元が返ったときは、経路検索に使うものが先頭に来る（trainroute側の契約）。
 */
async function loadTransitQuotas(): Promise<{ quotas: TransitQuota[] } | null> {
  if (!TRANSIT_ESTIMATE_ENABLED) return null;

  const quotas = await fetchTransitQuota();
  return quotas && quotas.length > 0 ? { quotas } : null;
}
