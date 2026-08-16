import { NextResponse } from "next/server";

import { buildActivityWidgetSummary } from "@/services/activity/summary";
import { resolveUserIdByWidgetToken } from "@/services/activity/widget-token";

/**
 * iPhoneウィジェット（Scriptable）が読む活動記録（docs/spec.md §28）。
 *
 * 認証はウィジェット専用トークンのみで、Supabaseのセッションは見ない。ウィジェットの更新は
 * 利用者が操作していない時点でiOSが走らせるため、ブラウザのセッションを前提にできない。
 * このパスは proxy.ts（middleware.ts）がSupabaseへ問い合わせずに素通しする。
 *
 * トークンはクエリではなく Authorization ヘッダーで受ける。クエリだとApacheのアクセスログに
 * そのまま残り、ログを見られるだけで他人の記録を読めるようになる。
 */
export async function GET(request: Request) {
  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) {
    return unauthorized("トークンがありません。設定のiPhoneウィジェットから台本を取り直してください。");
  }

  const userId = await resolveUserIdByWidgetToken(token);
  if (!userId) {
    return unauthorized("トークンが無効です。設定のiPhoneウィジェットから台本を取り直してください。");
  }

  const summary = await buildActivityWidgetSummary(userId);

  // ウィジェットは毎回その時点の値を見るためのもの。途中の経路に残されると、
  // 止めたはずの記録がいつまでも「記録中」で出続ける。
  return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
}

function readBearerToken(header: string | null): string | null {
  if (!header) return null;

  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}

function unauthorized(message: string): NextResponse {
  return NextResponse.json(
    { error: "unauthorized", message },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
