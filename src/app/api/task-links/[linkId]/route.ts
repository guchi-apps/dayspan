import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { resyncTaskLink, unlinkTask } from "@/services/task-links/links";
import { taskLinkErrorResponse } from "@/services/task-links/response";
import { isTaskEventStage } from "@/types/calendar";

type Body = { stage?: string };

/**
 * 紐づけを解決し直す（docs/spec.md §31）。
 *
 * 段階を変えたときは stage を送り、「予定に合わせる」を押したときは送らない。
 * どちらも「いまの予定から日時を決め直して行き先へ入れる」という同じ操作のため、経路は分けない。
 * 行き先そのものは変えられない（別の日付へ移すのは、解除してから紐づけ直す操作にする）。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ linkId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { linkId } = await params;
  const body = (await request.json().catch(() => ({}))) as Body;

  if (body.stage !== undefined && !isTaskEventStage(body.stage)) {
    return NextResponse.json(
      { error: "invalid_request", message: "段階を選んでください。" },
      { status: 400 },
    );
  }

  try {
    const result = await resyncTaskLink(userId, linkId, body.stage);
    return NextResponse.json({ ok: true, date: result.date });
  } catch (error) {
    return taskLinkErrorResponse(error, "紐づけの更新");
  }
}

/** 紐づけを外す。入っている日付はそのまま残す（消すと「いつやるつもりか」まで失われる）。 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ linkId: string }> },
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { linkId } = await params;
  const removed = await unlinkTask(userId, linkId);

  if (!removed) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
