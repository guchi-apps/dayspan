import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { getRequestOrigin } from "@/lib/request-origin";
import { buildScriptableWidgetScript } from "@/lib/scriptable-widget";
import { deleteWidgetToken, issueWidgetToken } from "@/services/activity/widget-token";

/**
 * ウィジェット用トークンの発行・作り直し（docs/spec.md §28）。
 *
 * 発行と作り直しを分けない。画面から見ればどちらも「新しい台本を作る」操作で、
 * 分けると押す前に現在の有無を利用者が意識することになる。
 *
 * 台本はここで組み立てて返す。ブラウザ側で組み立てると、台本の本文（9KB弱）が
 * 設定画面のJavaScriptに毎回付いてくる。
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = await issueWidgetToken(userId);
  const origin = getRequestOrigin(request);

  return NextResponse.json(
    {
      token,
      script: buildScriptableWidgetScript({
        endpoint: `${origin}/api/widget/activity`,
        token,
        appUrl: origin,
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** トークンを削除する。以後どの端末のウィジェットからも読めなくなる。 */
export async function DELETE() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const deleted = await deleteWidgetToken(userId);
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
