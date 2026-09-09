import {
  getShortcutTimeZone,
  rangeLabel,
  resolveShortcutUserId,
  shortcutError,
  shortcutFailure,
  shortcutJson,
  sleepDestinationNote,
} from "@/app/api/shortcuts/shared";
import { getRunningActivity, stopRunningActivity } from "@/services/activity/running";
import { getSleepSettings } from "@/services/activity/settings";

type Body = {
  /** 起床時刻（ISO 8601）。オートメーションから走る場合は送らなくてよい。 */
  at?: string;
};

/**
 * 起床時に睡眠の記録を止め、Google Calendarの予定にする（docs/spec.md §40）。
 *
 * iOSの個人用オートメーション「アラーム ▸ 停止したとき」から呼ぶ。
 *
 * **記録中が睡眠のときだけ止める。** アラームの停止は人が見ていない時点で走るため、前の晩に
 * 止め忘れた「仕事」が記録中だと、その記録が朝6時まで伸びた予定になる。睡眠でなければ何も
 * せず、何が記録中なのかを `message` で返す（止めるかどうかは利用者が決める）。
 */
export async function POST(request: Request) {
  const auth = await resolveShortcutUserId(request);
  if (!auth.ok) return auth.response;

  const { userId } = auth;

  // オートメーションは本文を付けずにPOSTする（/start と同じ扱い）。
  const body = ((await request.json().catch(() => ({}))) ?? {}) as Body;

  const endedAt = body.at ? new Date(body.at) : new Date();
  if (Number.isNaN(endedAt.getTime())) {
    return shortcutError(
      400,
      "invalid_time",
      "at の日時が読めませんでした。ISO 8601 の形式で送ってください。",
    );
  }

  const [{ title }, timeZone, running] = await Promise.all([
    getSleepSettings(userId),
    getShortcutTimeZone(userId),
    getRunningActivity(userId),
  ]);

  if (!running) {
    return shortcutJson({
      ok: true,
      status: "not_running",
      message: "記録していないため、何もしませんでした。",
    });
  }

  if (running.title.trim() !== title) {
    return shortcutJson({
      ok: true,
      status: "other_running",
      title: running.title,
      message: `記録中は「${running.title}」で${title}ではないため、止めませんでした。`,
    });
  }

  try {
    const result = await stopRunningActivity(userId, endedAt);

    // 直前の getRunningActivity では記録中だった。ここへ来るのは、その間に別の端末から
    // 止められた場合だけで、結果としては「止まっている」で正しい。
    if (result.status === "not_running") {
      return shortcutJson({
        ok: true,
        status: "not_running",
        message: "記録していないため、何もしませんでした。",
      });
    }

    return shortcutJson({
      ok: true,
      status: "saved",
      saved: result.range,
      message: `${title}を記録しました（${rangeLabel(result.range, timeZone)}）。${await sleepDestinationNote(userId)}`,
    });
  } catch (error) {
    return shortcutFailure("活動記録の保存", error);
  }
}
