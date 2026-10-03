import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import {
  commitSleepHealthExport,
  getSleepHealthTimeZone,
  loadSleepHealthExport,
  type SleepHealthExportResult,
} from "@/services/activity/sleep-health-export";

/**
 * iOSアプリがHealthKitへ睡眠を書くための取得と確定（docs/spec.md §40「iOSアプリから送る」）。
 *
 * ログイン済みのWebViewから、アプリ（Swift）が `fetch` で呼ぶ（通知の `/api/notifications/apns` と
 * 同じ形）。
 *
 * 1. `GET` … 追加で送る睡眠（`items`）・HealthKitに残る古い時間帯（`stale`）・確定へ返す `until`
 * 2. `POST { until }` … HealthKitへ書き終えたあとに呼び、印と履歴を進める
 */

function respond(result: SleepHealthExportResult) {
  const headers = { "Cache-Control": "no-store" };
  if (result.ok) return NextResponse.json(result.body, { headers });
  return NextResponse.json(
    { ok: false, error: result.error, message: result.message },
    { status: result.status, headers },
  );
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const timeZone = await getSleepHealthTimeZone(userId);
  return respond(await loadSleepHealthExport(userId, { now: new Date(), timeZone }));
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = ((await request.json().catch(() => ({}))) ?? {}) as { until?: unknown };
  const timeZone = await getSleepHealthTimeZone(userId);
  return respond(await commitSleepHealthExport(userId, body.until, timeZone));
}
