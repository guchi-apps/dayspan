import { NextResponse } from "next/server";

import { suggestPlaces, type PlaceSuggestInput } from "@/lib/ai-place-suggest";
import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { loadPlaces } from "@/services/notion/places";

/**
 * 場所の候補をAIに出させる。
 *
 * 呼び出しごとにプラン枠を消費するため、画面側では候補が0件のときのボタン操作からだけ呼ぶ。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "not_configured", message: "AIの提案が設定されていません（CLAUDE_CODE_OAUTH_TOKEN が未設定です）。" },
      { status: 503 },
    );
  }

  const body = (await request.json()) as { query?: string; eventTitle?: string };
  const query = body.query?.trim();
  if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });

  // 登録済みの場所は、よく行く範囲を推測させる手がかりとして渡す。
  const connection = await db.notionConnection.findUnique({ where: { userId } });
  const knownPlaces = (await loadPlaces(connection)).map((place) => ({
    name: place.name,
    address: place.address,
  }));

  const input: PlaceSuggestInput = { query, eventTitle: body.eventTitle ?? null, knownPlaces };

  try {
    const places = await suggestPlaces(token, input);
    return NextResponse.json({ places });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[dayspan] claude place suggestion failed:", detail);
    return NextResponse.json({ error: "ai_request_failed", message: detail }, { status: 502 });
  }
}
