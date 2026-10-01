import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { TaskNotEditableError } from "@/services/tasks";

import { TaskLinkError, TaskLinkExternalError } from "./links";

/** タスクDB以外のページ（ゴミの日・勤務記録など）への書き込みは、経路によらず断る。 */
const notEditable = () =>
  NextResponse.json(
    { error: "not_editable", message: "この項目はYoteiFlowからは変更できません。" },
    { status: 403 },
  );

/**
 * 紐づけの失敗を、理由が分かる形で返す。
 *
 * 紐づけはGoogle（予定の取得）とNotion（期限・予定日の書き込み）の両方を通るため、
 * 外部APIの失敗は出どころを保ったまま externalApiError へ渡す。まとめて1つの
 * 「保存できませんでした」にすると、どちらの連携を直せばよいのか画面から分からなくなる。
 *
 * `writeResolvedDate`（links.ts）が呼ぶ `updateTask` の対象ページ確認（`assertTaskPage`）で
 * 断られた場合は `TaskNotEditableError` が `TaskLinkExternalError` の `cause` として届くため、
 * タスク本体のAPI（`/api/tasks/[taskId]`）と同じ403へそろえる。
 */
export function taskLinkErrorResponse(error: unknown, operation: string): NextResponse {
  if (error instanceof TaskLinkExternalError) {
    if (error.cause instanceof TaskNotEditableError) return notEditable();
    return externalApiError(error.source, error.operation, error.cause);
  }

  if (error instanceof TaskLinkError) {
    return NextResponse.json({ error: "task_link_failed", message: error.message }, { status: 400 });
  }

  return externalApiError("notion", operation, error);
}
