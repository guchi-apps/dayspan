import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { getMonthsFetchRange } from "@/lib/calendar-range";
import { loadCalendarData } from "@/services/calendar/load";

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

// 1回の要求で取りにいける月数の上限。窓の幅を超える指定は想定していないため、
// 誤った要求で外部APIを大量に叩かないよう頭打ちにする。
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

  if (months.length === 0 || months.length > MAX_MONTHS) {
    return NextResponse.json({ error: "months is required" }, { status: 400 });
  }

  // loadCalendarData は Google / Notion の失敗を errors に載せて返すため、ここでは投げない。
  const data = await loadCalendarData(userId, getMonthsFetchRange(months));

  return NextResponse.json(data);
}
