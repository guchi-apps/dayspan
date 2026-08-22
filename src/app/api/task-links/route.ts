import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { linkTaskToEvent } from "@/services/task-links/links";
import { taskLinkErrorResponse } from "@/services/task-links/response";
import { DEFAULT_TASK_LINK_TARGET, isTaskEventStage, isTaskLinkTarget } from "@/types/calendar";

type Body = {
  taskId?: string;
  calendarId?: string;
  eventId?: string;
  stage?: string;
  /** 決まった日時の行き先。省略時は予定日（行き先を足す前と同じ結果になる）。 */
  target?: string;
};

/** タスクを予定へ紐づける（docs/spec.md §31）。 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Body;

  if (!body.taskId || !body.calendarId || !body.eventId) {
    return NextResponse.json(
      { error: "invalid_request", message: "taskId, calendarId, eventId は必須です。" },
      { status: 400 },
    );
  }

  // 段階の判定は画面でも行っているが、DaySpanのAPIや将来のMCPから直接呼ばれた要求は
  // 画面を通らない（docs/spec.md §22）。ここでも同じ条件で断る。
  if (!isTaskEventStage(body.stage)) {
    return NextResponse.json(
      { error: "invalid_request", message: "段階を選んでください。" },
      { status: 400 },
    );
  }

  // 行き先も画面で選ばせているが、同じ理由でここでも判定する。
  if (body.target !== undefined && !isTaskLinkTarget(body.target)) {
    return NextResponse.json(
      { error: "invalid_request", message: "紐づけ先の日付を選んでください。" },
      { status: 400 },
    );
  }

  const target = body.target ?? DEFAULT_TASK_LINK_TARGET;

  try {
    const result = await linkTaskToEvent(userId, {
      taskId: body.taskId,
      calendarId: body.calendarId,
      eventId: body.eventId,
      stage: body.stage,
      target,
    });

    return NextResponse.json({
      ok: true,
      date: result.date,
      target,
      linkId: result.link.id,
    });
  } catch (error) {
    return taskLinkErrorResponse(error, "タスクの紐づけ");
  }
}
