import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { getMonthsFetchRange, monthDistance } from "@/lib/calendar-range";
import { loadCalendarData } from "@/services/calendar/load";

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

// 1回の要求で取りにいける月の幅（先頭と末尾の差）の上限。窓の幅を超える指定は
// 想定していないため、誤った要求で外部APIを大量に叩かないよう頭打ちにする。
// 件数ではなく差で見るのは、months=2020-01,2026-12 のように件数は少なくても
// getMonthsFetchRange() が先頭と末尾から組む範囲が広がりうるため。
const MAX_MONTHS = 12;

/**
 * 指定した月の予定とタスクを返す。
 *
 * 月表示は前後の月まで地続きに保持し、窓から外れた月だけをここで取りにいく。
 * ページ全体を描き直すと開いているダイアログが閉じてしまうため、
 * サーバーコンポーネントの再レンダリングではなくこのAPIを使う。
 */
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const months = (new URL(request.url).searchParams.get("months") ?? "")
    .split(",")
    .filter((month) => MONTH_KEY.test(month));

  const sortedMonths = [...months].sort();
  const span =
    sortedMonths.length === 0
      ? 0
      : monthDistance(sortedMonths[0], sortedMonths[sortedMonths.length - 1]);

  if (sortedMonths.length === 0 || span >= MAX_MONTHS) {
    return NextResponse.json({ error: "months is required" }, { status: 400 });
  }

  // loadCalendarData は Google / Notion の失敗を errors に載せて返すため、ここでは投げない。
  const data = await loadCalendarData(userId, getMonthsFetchRange(months));

  return NextResponse.json(data);
}
