import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { listActivityPresets } from "@/services/activity/presets";
import { getRunningActivity } from "@/services/activity/running";

/**
 * 記録の選択肢と、進行中の記録を返す（docs/spec.md §27）。
 *
 * カレンダー画面はサーバー側で描くときに同じものを渡しているため、ここを読むのは
 * 保存のあとに画面の表示だけを更新したいときになる。外部APIには触れないので、
 * ページ全体を取り直すより軽い。
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [presets, running] = await Promise.all([
    listActivityPresets(userId),
    getRunningActivity(userId),
  ]);

  return NextResponse.json({ presets, running });
}
