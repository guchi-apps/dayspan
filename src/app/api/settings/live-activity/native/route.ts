import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { getOrIssueActivityStopToken } from "@/services/live-activity/devices";

/**
 * iOSアプリがロック画面の停止ボタン用に持つトークンの受け渡し口（issue #971）。
 * ログイン済みのWebViewから呼ばれ、アプリが App Group の Keychain へ保存する。
 * 作り直さない（起動のたびに呼ばれる）。応答はトークンを含むので保存させない。
 */
export async function POST() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    { token: await getOrIssueActivityStopToken(userId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
