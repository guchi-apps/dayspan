import { NextResponse } from "next/server";

import {
  ActivityRecordChangedError,
  ActivityTimeRangeError,
  type ExpectedRunning,
} from "@/services/activity/running";

/**
 * 操作が向けられた記録（開始時刻・項目名）の前提条件を読む（issue #974）。
 * 指定が無い（従来の呼び出し）なら undefined で、何も確かめない。読めない値は無視せず null を返す。
 */
export function parseExpected(
  startedAt: unknown,
  title: unknown,
): ExpectedRunning | undefined | null {
  if (startedAt === undefined || startedAt === null || startedAt === "") return undefined;
  if (typeof startedAt !== "string") return null;

  const parsed = new Date(startedAt);
  if (Number.isNaN(parsed.getTime())) return null;

  return { startedAt: parsed, title: typeof title === "string" ? title : undefined };
}

/** 時刻・前提条件の失敗を応答へ直す。該当しなければ null。 */
export function activityConflictResponse(error: unknown): NextResponse | null {
  if (error instanceof ActivityTimeRangeError) {
    return NextResponse.json(
      { error: error.code ?? "invalid_time", message: error.message },
      { status: 400 },
    );
  }
  if (error instanceof ActivityRecordChangedError) {
    return NextResponse.json(
      { error: "record_changed", message: error.message },
      { status: 409 },
    );
  }
  return null;
}
