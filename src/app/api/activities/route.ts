import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { listActivityPresets } from "@/services/activity/presets";
import { getRunningActivity } from "@/services/activity/running";

/**
 * 記録をその場で始める・止めるのに要るもの一式（docs/spec.md §27）。
 *
 * メインナビの記録の長押しで開くシートが呼ぶ。項目と記録中の1件を1回の往復で返すのは、
 * 長押ししてからシートの中身が出るまでの間を短くするため。
 *
 * 各画面のサーバー側で先に読まないのは、下部ナビがカレンダー・タスク・日付の画面にも
 * 出るためである。全画面で項目を読むと、開くたびにDBの読み取りが1つずつ増える。
 * 記録中かどうかをここで取り直すのは、別の端末で開始・停止していることがあるため。
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
