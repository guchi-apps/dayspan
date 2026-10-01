import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { getOrIssueWidgetToken } from "@/services/activity/widget-token";

/**
 * iOSアプリがウィジェット（WidgetKit）へ渡すトークンの受け渡し口（issue #926）。
 *
 * ログイン済みのWebViewから呼ばれ、アプリが App Group の Keychain へ保存する。ウィジェットの
 * 更新はアプリが動いていない時点でiOSが走らせるため、Supabaseのセッションでは読めず、
 * `/api/widget/*` と同じ読み取り専用のトークンを使う。
 *
 * 作り直しはしない（`getOrIssueWidgetToken()`）。起動のたびに呼ばれるため、作り直すと
 * Scriptableの台本に埋め込んだトークンが失効する。応答はトークンを含むので保存させない。
 */
export async function POST() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    { token: await getOrIssueWidgetToken(userId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
