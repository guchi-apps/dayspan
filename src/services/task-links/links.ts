import type { GoogleAccount, TaskEventLink } from "@prisma/client";

import { db } from "@/lib/db";
import { getNotionConnection } from "@/services/calendar/write-context";
import { getEvent, toCalendarItems } from "@/services/google-calendar/events";
import { createNotionClient } from "@/services/notion/client";
import type { PropertyMap } from "@/services/notion/task-database";
import { updateTask } from "@/services/notion/tasks";
import type {
  CalendarEventItem,
  TaskEventLinkItem,
  TaskEventStage,
  TaskItem,
} from "@/types/calendar";

import { isSameTaskDate, resolveStageDate } from "./stage";

/**
 * タスクと予定の紐づけ（docs/spec.md §31）。
 *
 * 紐づけ本体はDaySpanのDBにあり、そこから決まる日時はNotionのタスクの「予定日」へ書き込む。
 * 予定日へ入れるのは、カレンダーの取得・描画を既存の予定日の経路のまま使えるようにするため。
 * 新しい枠を足すと、1つのタスクが期限・予定日と合わせて3枠に現れることになる。
 *
 * 書き込みの順序はNotionが先、DaySpanのDBが後にする。逆にすると、Notionへの書き込みが
 * 失敗したときに「紐づいているのに予定日が入っていない」行が残る。先にNotionへ入れておけば、
 * DBの保存で失敗しても残るのは普通の予定日だけで、もう一度紐づければやり直せる。
 */

/**
 * 予定名の写しの上限。Prismaの String は varchar(191) で作られるため、これを超える名前を
 * そのまま入れると保存そのものが失敗する。表示のためだけに持っている値なので、切って通す。
 */
const EVENT_TITLE_LIMIT = 191;

function toEventTitle(title: string): string {
  return title.length > EVENT_TITLE_LIMIT ? title.slice(0, EVENT_TITLE_LIMIT) : title;
}

/** 画面へ返せる理由を持つ失敗。外部APIの失敗（TaskLinkExternalError）とは分けて扱う。 */
export class TaskLinkError extends Error {}

/**
 * 外部APIの失敗。紐づけはGoogle（予定の取得）とNotion（予定日の書き込み）の両方を通るため、
 * どちらで落ちたかを持ったまま呼び出し元へ返す。握りつぶすと、スコープ不足なのか
 * プロパティ不足なのかを画面からもログからも切り分けられなくなる（docs/spec.md §26）。
 */
export class TaskLinkExternalError extends Error {
  constructor(
    readonly source: "google" | "notion",
    readonly operation: string,
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

export type TaskLinkInput = {
  taskId: string;
  calendarId: string;
  eventId: string;
  stage: TaskEventStage;
};

export async function listTaskLinks(userId: string): Promise<TaskEventLink[]> {
  return db.taskEventLink.findMany({ where: { userId } });
}

export async function getTaskLink(userId: string, linkId: string): Promise<TaskEventLink | null> {
  return db.taskEventLink.findFirst({ where: { id: linkId, userId } });
}

export async function getTaskLinkByTaskId(
  userId: string,
  taskId: string,
): Promise<TaskEventLink | null> {
  return db.taskEventLink.findUnique({ where: { userId_taskId: { userId, taskId } } });
}

/** DBに入っている解決済みの日時を、タスクの日付と同じ形（日付のみ／ISO 8601）へ戻す。 */
function resolvedDate(link: TaskEventLink): string {
  const iso = link.resolvedAt.toISOString();
  return link.resolvedAllDay ? iso.slice(0, 10) : iso;
}

/** 日付のみは その日の00:00(UTC) として持つ。日付のみかどうかは resolvedAllDay で分ける。 */
function toResolvedColumns(resolved: { date: string; allDay: boolean }) {
  return {
    resolvedAt: new Date(resolved.allDay ? `${resolved.date}T00:00:00Z` : resolved.date),
    resolvedAllDay: resolved.allDay,
  };
}

/**
 * タスクへ紐づけを付ける。
 *
 * 予定が手元にある（＝カレンダーの取得範囲に入っている）ときは、予定名を最新の値へ差し替え、
 * 予定日とのずれも判定する。予定が無いときはずれを判定しない。取得範囲の外にあるだけなのか、
 * 予定が消えているのかをここでは区別できず、消えたことにすると範囲を送るたびに警告が出るため。
 */
export function attachTaskLinks(
  tasks: TaskItem[],
  links: TaskEventLink[],
  eventsById?: Map<string, CalendarEventItem>,
): TaskItem[] {
  if (links.length === 0) return tasks;

  const byTaskId = new Map(links.map((link) => [link.taskId, link]));

  return tasks.map((task) => {
    const link = byTaskId.get(task.id);
    if (!link) return task;

    const event = eventsById?.get(link.eventId);
    const stage = link.stage as TaskEventStage;
    const expected = event ? resolveStageDate(event, stage) : null;
    const drifted = expected
      ? !isSameTaskDate(
          { date: task.planned, allDay: !task.plannedHasTime },
          { date: expected.date, allDay: expected.allDay },
        )
      : false;

    const item: TaskEventLinkItem = {
      id: link.id,
      taskId: link.taskId,
      calendarId: link.calendarId,
      eventId: link.eventId,
      stage,
      eventTitle: event?.title ?? link.eventTitle,
      resolvedAt: resolvedDate(link),
      resolvedAllDay: link.resolvedAllDay,
      drifted,
      expectedAt: drifted && expected ? expected.date : null,
    };

    return { ...task, link: item };
  });
}

/**
 * 紐づけ先の予定を1件取得する。
 *
 * 「使用」がオフのカレンダーでも取得する。紐づけはGoogleへ書き込まないため、
 * resolveGoogleAccountForCalendar() の書き込み判定を通す必要が無い。見たいだけの
 * カレンダー（共有された予定表）に対しても、その予定に合わせたタスクは置ける。
 */
async function fetchLinkedEvent(
  userId: string,
  calendarId: string,
  eventId: string,
): Promise<CalendarEventItem | null> {
  const setting = await db.calendarSetting.findFirst({
    where: { userId, calendarId },
    include: { googleAccount: true },
  });
  if (!setting) return null;

  return getLinkedEvent(setting.googleAccount, calendarId, eventId);
}

async function getLinkedEvent(
  account: GoogleAccount,
  calendarId: string,
  eventId: string,
): Promise<CalendarEventItem | null> {
  let event;
  try {
    event = await getEvent(account, calendarId, eventId);
  } catch (error) {
    // 予定が消えている場合の404・410は「見つからない」として扱い、紐づけを外す案内へ回す。
    if (isMissingEventError(error)) return null;
    throw new TaskLinkExternalError("google", "紐づけ先の予定の取得", error);
  }

  if (event.status === "cancelled") return null;

  // 名前・色は紐づけでは使わないが、終日の終了日の扱いを一覧と揃えるため同じ変換を通す。
  const [item] = toCalendarItems([event], {
    calendarId,
    name: "",
    color: null,
    readOnly: false,
  });

  return item ?? null;
}

/** 決まった日時をNotionのタスクの予定日へ入れる。 */
async function writePlanned(userId: string, taskId: string, date: string): Promise<void> {
  const connection = await getNotionConnection(userId);
  if (!connection) {
    throw new TaskLinkError("Notionのタスクが接続されていません。");
  }

  const propertyMap = (connection.propertyMap as PropertyMap | null) ?? {};
  if (!propertyMap.planned) {
    throw new TaskLinkError(
      "タスクDBに「予定日」のプロパティがありません。Notionへ足してから、設定画面でタスクDBを選び直してください。",
    );
  }

  try {
    await updateTask(createNotionClient(connection), connection, taskId, { planned: date });
  } catch (error) {
    throw new TaskLinkExternalError("notion", "タスクの予定日の更新", error);
  }
}

/** Googleが「その予定は無い」と答えたか。googleCalendarFetch はステータスを文面に含める。 */
function isMissingEventError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(404|410)\b/.test(message);
}

/** 紐づける。すでに紐づいているタスクは、その1件を置き換える（タスクにつき1件）。 */
export async function linkTaskToEvent(
  userId: string,
  input: TaskLinkInput,
): Promise<{ link: TaskEventLink; planned: string }> {
  const event = await fetchLinkedEvent(userId, input.calendarId, input.eventId);
  if (!event) {
    throw new TaskLinkError("紐づけ先の予定が見つかりませんでした。");
  }

  const resolved = resolveStageDate(event, input.stage);
  await writePlanned(userId, input.taskId, resolved.date);

  const data = {
    calendarId: input.calendarId,
    eventId: input.eventId,
    stage: input.stage,
    eventTitle: toEventTitle(event.title),
    ...toResolvedColumns(resolved),
  };

  const link = await db.taskEventLink.upsert({
    where: { userId_taskId: { userId, taskId: input.taskId } },
    create: { userId, taskId: input.taskId, ...data },
    update: data,
  });

  return { link, planned: resolved.date };
}

/**
 * 紐づけを解決し直す。段階を変えたときと、「予定に合わせる」を押したときの両方で通る。
 *
 * DaySpanの外（Googleカレンダーのアプリなど）で予定が動いた場合、カレンダーを取得するたびに
 * Notionへ書き戻すことはしない。読み取りの途中で外部APIへの書き込みが積み上がるため
 * （docs/spec.md §20）。ずれは画面に出し、押されたときにここを通す。
 */
export async function resyncTaskLink(
  userId: string,
  linkId: string,
  stage?: TaskEventStage,
): Promise<{ link: TaskEventLink; planned: string }> {
  const existing = await getTaskLink(userId, linkId);
  if (!existing) {
    throw new TaskLinkError("紐づけが見つかりませんでした。");
  }

  const event = await fetchLinkedEvent(userId, existing.calendarId, existing.eventId);
  if (!event) {
    throw new TaskLinkError(
      "紐づけ先の予定が見つかりませんでした。予定が消えている場合は紐づけを解除してください。",
    );
  }

  const nextStage = stage ?? (existing.stage as TaskEventStage);
  const resolved = resolveStageDate(event, nextStage);
  await writePlanned(userId, existing.taskId, resolved.date);

  const link = await db.taskEventLink.update({
    where: { id: existing.id },
    data: { stage: nextStage, eventTitle: toEventTitle(event.title), ...toResolvedColumns(resolved) },
  });

  return { link, planned: resolved.date };
}

/**
 * 紐づけを外す。予定日はそのまま残す。
 *
 * 消してしまうと、紐づけを外しただけで「いつやるつもりだったか」まで失われる。
 * 要らなければ予定日を未設定にすればよく、そちらは元に戻せる操作ではない。
 */
export async function unlinkTask(userId: string, linkId: string): Promise<boolean> {
  const existing = await getTaskLink(userId, linkId);
  if (!existing) return false;

  await db.taskEventLink.delete({ where: { id: existing.id } });
  return true;
}

/** タスクを消した・完了で作り直したときに、そのタスクの紐づけを外す。 */
export async function unlinkTaskByTaskId(userId: string, taskId: string): Promise<void> {
  await db.taskEventLink.deleteMany({ where: { userId, taskId } });
}

/**
 * 予定が動いたときに、紐づいたタスクの予定日を追随させる。
 *
 * 予定の更新そのものは成功しているため、ここでの失敗で応答全体を失敗にしない。
 * 追随できなかった紐づけは予定日がずれたまま残り、次に画面へ出たときにずれとして示される。
 */
export async function syncLinksForEvent(
  userId: string,
  eventId: string,
  event: Pick<CalendarEventItem, "allDay" | "start" | "end" | "title">,
): Promise<{ synced: number; failed: number }> {
  const links = await db.taskEventLink.findMany({ where: { userId, eventId } });
  if (links.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const link of links) {
    const resolved = resolveStageDate(event, link.stage as TaskEventStage);
    try {
      await writePlanned(userId, link.taskId, resolved.date);
      await db.taskEventLink.update({
        where: { id: link.id },
        data: { eventTitle: toEventTitle(event.title), ...toResolvedColumns(resolved) },
      });
      synced += 1;
    } catch (error) {
      failed += 1;
      console.error(
        "[dayspan] task link sync failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  return { synced, failed };
}

/**
 * 予定を消したときに紐づけを外す（予定日は残す）。
 *
 * 画面に出ている繰り返し予定は展開した1回分で、IDは `<親のID>_<日時>` の形になる。
 * シリーズ全体・これ以降を消した場合は消えた回のぶんだけ外す必要があるため、
 * 親のIDを前にした範囲で引く。
 */
export async function dropLinksForEvent(
  userId: string,
  eventId: string,
  scope: "single" | "following" | "all",
): Promise<number> {
  const separator = eventId.indexOf("_");

  if (scope === "single" || separator < 0) {
    const result = await db.taskEventLink.deleteMany({ where: { userId, eventId } });
    return result.count;
  }

  const prefix = `${eventId.slice(0, separator)}_`;
  const result = await db.taskEventLink.deleteMany({
    where: {
      userId,
      // 回のIDは `<親のID>_YYYYMMDDTHHMMSSZ` で桁が揃っているため、文字列の大小で前後を比べられる。
      eventId: scope === "all" ? { startsWith: prefix } : { startsWith: prefix, gte: eventId },
    },
  });

  return result.count;
}
