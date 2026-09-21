import { NextResponse } from "next/server";

import { getAiUsageResponse } from "@/lib/ai-usage-log";
import { isOpsApiAuthorized } from "@/lib/ops-api-auth";

/**
 * ops-dashboard の「アプリ別のAI利用」が読む、AIの使用量の口（issue #680・docs/internal-api.md）。
 *
 * 機能×モデルごとに、直近24時間・7日間の呼び出し回数とトークン数を返す。応答の形の正は
 * ops-dashboard の README「アプリ別のAI利用」。1行でも形が違うと、ops-dashboard は応答全体を
 * 採用せず「取得不可」と出す。
 *
 * 認証は `Authorization: Bearer <OPS_API_TOKEN>`（ops-dashboard と同じ値）。未設定・不一致は
 * どちらも401。呼び出しが無い期間は `{ "features": [] }` を返す（エラーにしない）。
 * 返すのは回数とトークン数だけで、プロンプト本文・入力した文字列は含めない。
 */
export async function GET(request: Request) {
  if (!isOpsApiAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  try {
    return NextResponse.json(await getAiUsageResponse(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[dayspan] AI usage aggregation failed:", error);
    return NextResponse.json(
      { error: "aggregation_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
