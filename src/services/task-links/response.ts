import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";

import { TaskLinkError, TaskLinkExternalError } from "./links";

/**
 * 紐づけの失敗を、理由が分かる形で返す。
 *
 * 紐づけはGoogle（予定の取得）とNotion（期限・予定日の書き込み）の両方を通るため、
 * 外部APIの失敗は出どころを保ったまま externalApiError へ渡す。まとめて1つの
 * 「保存できませんでした」にすると、どちらの連携を直せばよいのか画面から分からなくなる。
 */
export function taskLinkErrorResponse(error: unknown, operation: string): NextResponse {
  if (error instanceof TaskLinkExternalError) {
    return externalApiError(error.source, error.operation, error.cause);
  }

  if (error instanceof TaskLinkError) {
    return NextResponse.json({ error: "task_link_failed", message: error.message }, { status: 400 });
  }

  return externalApiError("notion", operation, error);
}
