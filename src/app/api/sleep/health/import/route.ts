import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { externalApiMessage } from "@/lib/api-error";
import { MAX_SLEEP_MINUTES } from "@/lib/sleep-shortcut";
import {
  ActivityCalendarNotFoundError,
  ActivityTimeRangeError,
} from "@/services/activity/running";
import { recordSleepRange } from "@/services/activity/sleep";

/**
 * iOSアプリがヘルスケアの睡眠分析を読み取って、睡眠の活動記録として取り込む（docs/spec.md §40「iOSアプリから取り込む」）。
 *
 * ログイン済みのWebViewからアプリ（Swift）が呼ぶ（`/api/sleep/health` と同じ形）。本文は
 * `{ ranges: [{ start, end }] }`（ISO 8601）。時間帯の組み立て（睡眠ステージのまとめ・自アプリが
 * 書いたサンプルの除外）はアプリ側で行い、ここは1件ずつ `recordSleepRange()` へ渡すだけにする。
 * 同じ時間帯の睡眠がすでにあれば作られないため、アプリが同じ範囲を何度送っても重複しない。
 */

const MAX_RANGES = 20;

type Body = { ranges?: unknown };

function readRange(value: unknown): { start: Date; end: Date } | null {
  const record = value as Record<string, unknown> | null;
  if (typeof record !== "object" || record === null) return null;
  if (typeof record.start !== "string" || typeof record.end !== "string") return null;

  const start = new Date(record.start);
  const end = new Date(record.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end.getTime() <= start.getTime()) return null;
  if (end.getTime() - start.getTime() > MAX_SLEEP_MINUTES * 60_000) return null;

  return { start, end };
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = ((await request.json().catch(() => ({}))) ?? {}) as Body;
  if (!Array.isArray(body.ranges) || body.ranges.length > MAX_RANGES) {
    return NextResponse.json(
      { ok: false, error: "invalid_ranges", message: `ranges は${MAX_RANGES}件までの配列で送ってください。` },
      { status: 400 },
    );
  }

  const ranges = body.ranges.map(readRange).filter((range) => range !== null);

  let saved = 0;
  let overlapping = 0;
  let rejected = body.ranges.length - ranges.length;

  for (const range of ranges) {
    try {
      const result = await recordSleepRange(userId, range);
      if (result.status === "saved") saved += 1;
      else overlapping += 1;
    } catch (error) {
      if (error instanceof ActivityCalendarNotFoundError) {
        return NextResponse.json(
          { ok: false, error: "calendar_not_found", message: error.message, saved, overlapping },
          { status: 409 },
        );
      }
      // 未来の時刻など、その1件だけ受け付けられないもの。残りは続ける。
      if (error instanceof ActivityTimeRangeError) {
        rejected += 1;
        continue;
      }
      return NextResponse.json(
        {
          ok: false,
          error: "google_request_failed",
          message: externalApiMessage("google", "睡眠の取り込み", error),
          saved,
          overlapping,
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    { ok: true, saved, overlapping, rejected },
    { headers: { "Cache-Control": "no-store" } },
  );
}
