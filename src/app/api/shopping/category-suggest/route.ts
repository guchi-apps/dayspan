import { NextResponse } from "next/server";

import { MAX_CATEGORIES, suggestShoppingCategory } from "@/lib/ai-shopping-category";
import { requireUserId } from "@/lib/auth-user";
import { hasTypeSafeApiKey } from "@/lib/typesafe-system-one";

/**
 * アイテム名から買い物のカテゴリをJevに選ばせる。
 *
 * カテゴリの一覧は画面が持っているもの（その場で足した分を含む）を受け取り、Notionは読まない。
 * 答えは送られた一覧に含まれるものだけを返す（合うものが無ければ null）。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!hasTypeSafeApiKey()) {
    return NextResponse.json(
      { error: "not_configured", message: "カテゴリの自動判定が設定されていません（TYPESAFE_API_KEY が未設定です）。" },
      { status: 503 },
    );
  }

  let body: { name?: unknown; categories?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const categories = body.categories;
  if (
    !Array.isArray(categories) ||
    categories.length === 0 ||
    categories.length > MAX_CATEGORIES ||
    !categories.every((item) => typeof item === "string" && item.trim() !== "")
  ) {
    return NextResponse.json({ error: "categories is invalid" }, { status: 400 });
  }

  const result = await suggestShoppingCategory({ name, categories: categories as string[] });
  if (!result) {
    return NextResponse.json(
      { error: "ai_request_failed", message: "カテゴリを判定できませんでした。" },
      { status: 502 },
    );
  }
  return NextResponse.json({ category: result.category });
}
