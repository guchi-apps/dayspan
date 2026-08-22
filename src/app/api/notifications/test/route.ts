import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { isPushConfigured } from "@/lib/web-push/keys";
import { loadBadgeCount } from "@/services/notifications/badge";
import { sendToUser } from "@/services/notifications/subscriptions";

/**
 * テスト通知（docs/spec.md §32）。
 *
 * 通知が出ない原因は、許可・購読・鍵・iOSの設定のどこにでもありうる。設定画面から1通送れると、
 * 「サーバーからは送れている」ところまでを切り分けられる。バッジも一緒に更新して、
 * アイコンの数字が動くかどうかもこの1回で確かめられるようにする。
 */
export async function POST() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: "push_not_configured", message: "サーバーで通知の鍵が設定されていません。" },
      { status: 503 },
    );
  }

  const badge = await loadBadgeCount(userId);

  const summary = await sendToUser(userId, {
    title: "DaySpanのテスト通知",
    body:
      badge === null
        ? "この通知が出れば、通知の設定は完了です。"
        : `この通知が出れば、通知の設定は完了です。期限が今日までのタスクは${badge}件です。`,
    path: "/settings/notifications",
    badge,
  });

  if (summary.sent === 0) {
    return NextResponse.json(
      {
        error: "no_subscription",
        message:
          summary.removed > 0
            ? "登録されていた端末が無効になっていました。もう一度「この端末で受け取る」を入れてください。"
            : "通知を受け取れる端末がありません。「この端末で受け取る」を入れてください。",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ summary });
}
