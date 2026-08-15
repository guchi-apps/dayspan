import { db } from "@/lib/db";
import { getActivityCalendarId } from "@/services/activity/settings";
import { createEvent } from "@/services/google-calendar/events";
import { SETTING_ORDER } from "@/services/google-calendar/settings";
import { resolveGoogleAccountForCalendar } from "@/services/calendar/write-context";
import type { ActivitySavedRange, RunningActivityItem } from "@/types/activity";

/**
 * 記録の最短の長さ（分）。
 *
 * 押し間違えてすぐ止めると開始と終了が同じ時刻になり、Googleは長さの無い予定を受け付けない。
 * 記録した事実は残したいので、断らずにこの長さまで伸ばす。
 */
const MIN_ACTIVITY_MINUTES = 1;

/** 進行中の記録。無ければ null。 */
export async function getRunningActivity(userId: string): Promise<RunningActivityItem | null> {
  const running = await db.runningActivity.findUnique({ where: { userId } });
  if (!running) return null;

  return {
    title: running.title,
    calendarId: running.calendarId,
    startedAt: running.startedAt.toISOString(),
  };
}

/**
 * 記録を始める。すでに記録中なら、それをその時刻で終わらせてから始める。
 *
 * 前の記録の書き出しに失敗した場合は例外のまま抜け、新しい記録も始めない。
 * 始めてしまうと、書き出せなかったぶんが画面からも消えて取り戻せなくなるため。
 */
export async function startActivity(
  userId: string,
  input: { title: string },
): Promise<{ running: RunningActivityItem; saved: ActivitySavedRange | null }> {
  // 切り替えでは、前の記録の終わりと次の記録の始まりを同じ時刻にする。
  // それぞれで現在時刻を取ると、その間に何も記録していない数ミリ秒の隙間ができる。
  const now = new Date();

  const saved = await stopRunningActivity(userId, now);

  const calendarId = await resolveActivityCalendarId(userId);
  if (!calendarId) {
    throw new ActivityCalendarNotFoundError();
  }

  const running = await db.runningActivity.upsert({
    where: { userId },
    create: { userId, title: input.title, calendarId, startedAt: now },
    update: { title: input.title, calendarId, startedAt: now },
  });

  return {
    running: {
      title: running.title,
      calendarId: running.calendarId,
      startedAt: running.startedAt.toISOString(),
    },
    saved: saved.status === "saved" ? saved.range : null,
  };
}

export type StopResult =
  | { status: "not_running" }
  | { status: "saved"; range: ActivitySavedRange };

/**
 * 記録を終わらせ、Google Calendarの予定にする。
 *
 * 予定を作れた場合だけ進行中の行を消す。先に消すと、Googleが失敗したときに
 * 記録していた時間そのものが失われる。失敗は例外のまま呼び出し側へ返し、
 * 画面には外部APIが返した理由を出す（CLAUDE.md「外部APIの扱い」）。
 */
export async function stopRunningActivity(userId: string, endedAt: Date): Promise<StopResult> {
  const running = await db.runningActivity.findUnique({ where: { userId } });
  if (!running) return { status: "not_running" };

  // 記録を始めたあとで保存先の「使用」がオフにされることもある。そのときもここで止まる。
  const target = await resolveGoogleAccountForCalendar(userId, running.calendarId);
  if (!target.ok) {
    throw new ActivityCalendarNotFoundError(target.reason);
  }

  const start = running.startedAt;
  const end = new Date(
    Math.max(endedAt.getTime(), start.getTime() + MIN_ACTIVITY_MINUTES * 60_000),
  );

  const uiSetting = await db.uiSetting.findUnique({ where: { userId } });

  await createEvent(target.account, running.calendarId, {
    title: running.title,
    allDay: false,
    start: start.toISOString(),
    end: end.toISOString(),
    timeZone: uiSetting?.timeZone ?? "Asia/Tokyo",
  });

  await db.runningActivity.deleteMany({ where: { userId } });

  return { status: "saved", range: { start: start.toISOString(), end: end.toISOString() } };
}

/**
 * 進行中の記録を、予定にせず取り消す。
 *
 * 押し間違えて始めた記録まで予定として残すと、消しにいく手間のほうが大きい。
 * 予定を作る前に捨てられる経路をここだけに用意する。
 */
export async function discardRunningActivity(userId: string): Promise<boolean> {
  const result = await db.runningActivity.deleteMany({ where: { userId } });
  return result.count > 0;
}

/**
 * 進行中の記録の開始時刻を直す。
 *
 * 記録は始めるときに押すものだが、押し忘れて後から気付くほうが多い。
 * 始めた時刻を直せないと、いったん止めてGoogle側で予定を直すことになる。
 */
export async function updateRunningActivityStart(
  userId: string,
  startedAt: Date,
): Promise<RunningActivityItem | null> {
  // まだ来ていない時刻から記録していることにはできない。
  if (startedAt.getTime() > Date.now()) return null;

  const result = await db.runningActivity.updateMany({ where: { userId }, data: { startedAt } });
  if (result.count === 0) return null;

  return getRunningActivity(userId);
}

/**
 * 保存先カレンダーを決める。
 *
 * 保存先は項目ごとではなく、記録全体で1つ（UiSetting.activityCalendarId）。指定されていれば
 * それを使い、無ければ予定作成の既定の保存先へ入れる。
 * 指定があってもそのユーザーの設定に無いカレンダー、および「使用」がオフのカレンダーは
 * 使わない（設定したあとにカレンダーを消した・共有を外された場合や、始めた時点では
 * 使用オンだったが後でオフにされた場合に、書けない保存先のまま止まらないようにするため）。
 */
export async function resolveActivityCalendarId(userId: string): Promise<string | null> {
  const preferred = await getActivityCalendarId(userId);

  if (preferred) {
    const owned = await db.calendarSetting.findFirst({
      where: { userId, calendarId: preferred, writeEnabled: true },
      select: { calendarId: true },
    });
    if (owned) return owned.calendarId;
  }

  const fallback = await db.calendarSetting.findFirst({
    where: { userId, writeEnabled: true },
    orderBy: [{ isCreateDefault: "desc" }, ...SETTING_ORDER],
    select: { calendarId: true },
  });

  return fallback?.calendarId ?? null;
}

/**
 * 書き込めるカレンダーが決まらない状態。Google未接続や、保存先を消したあとに起きる。
 *
 * 記録を始めたあとで保存先の「使用」がオフにされた場合も同じ経路に入る。文面を分けないと、
 * 消えたカレンダーを探しにいくことになる（実際は設定を戻せば保存できる）。
 */
export class ActivityCalendarNotFoundError extends Error {
  constructor(reason: "not_found" | "write_disabled" = "not_found") {
    super(
      reason === "write_disabled"
        ? "保存先のカレンダーが使用しない設定になっています。設定のGoogle Calendarで「使用」をオンにしてから、もう一度停止してください。"
        : "保存先のカレンダーが見つかりません。設定からGoogle Calendarを確認してください。",
    );
    this.name = "ActivityCalendarNotFoundError";
  }
}
