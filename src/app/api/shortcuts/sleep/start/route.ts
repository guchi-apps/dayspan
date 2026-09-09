import { after } from "next/server";

import {
  clockLabel,
  getShortcutTimeZone,
  rangeLabel,
  resolveShortcutUserId,
  shortcutError,
  shortcutFailure,
  shortcutJson,
  sleepDestinationNote,
} from "@/app/api/shortcuts/shared";
import { sleepNightKey } from "@/lib/sleep";
import { getRunningActivity, startActivity } from "@/services/activity/running";
import { getSleepSettings } from "@/services/activity/settings";
import { notifyActivityStarted } from "@/services/notifications/activity";

type Body = {
  /** 就寝時刻（ISO 8601）。オートメーションから走る場合は送らなくてよい。 */
  at?: string;
};

/**
 * 就寝時に睡眠の記録を始める（docs/spec.md §40）。
 *
 * iOSの個人用オートメーション「睡眠 ▸ 就寝時」から呼ぶ。本文は無くてよく、その場合は
 * サーバーの時計で始める（端末の時計がずれていると、記録した時間帯そのものがずれるため。
 * 押して始めたときと同じ扱い）。
 *
 * 記録中の別項目があれば、そこまでを予定にしてから切り替わる（`startActivity()` の既存の
 * 振る舞いのまま）。夜のうちに「仕事」を止め忘れていても、就寝の時点でそこまでが予定になる。
 */
export async function POST(request: Request) {
  const auth = await resolveShortcutUserId(request);
  if (!auth.ok) return auth.response;

  const { userId } = auth;

  // オートメーションは本文を付けずにPOSTする。JSONとして読めないことは失敗ではなく
  // 「時刻の指定が無い」ことを意味する（/api/activities/stop と同じ扱い）。
  const body = ((await request.json().catch(() => ({}))) ?? {}) as Body;

  const startedAt = body.at ? new Date(body.at) : undefined;
  if (startedAt && Number.isNaN(startedAt.getTime())) {
    return shortcutError(
      400,
      "invalid_time",
      "at の日時が読めませんでした。ISO 8601 の形式で送ってください。",
    );
  }

  const [{ title }, timeZone] = await Promise.all([
    getSleepSettings(userId),
    getShortcutTimeZone(userId),
  ]);

  const running = await getRunningActivity(userId);

  // 記録中がすでに睡眠なら、それが**同じ夜のもの**であるときだけ何もしない。
  // オートメーションは条件が揃えば何度でも走るため、そのまま startActivity() へ流すと、
  // そこまでを予定にして新しい睡眠を始めることになり、同じ夜が2件に割れる。
  //
  // 一方で無条件に短絡させると、アラームが鳴らなかった朝（休日・端末の電源断）に `/stop` が
  // 走らず持ち越された記録を、どの経路も終わらせられなくなる（`/api/shortcuts/sleep` も
  // 重なる記録があれば作らない）。翌朝に止まった時点で31時間の予定が1件でき、`buildSleepNights()`
  // が2夜ぶんの行を丸ごと埋めて平均も中央値も壊れる（issue #608 計画レビューG1の指摘）。
  //
  // 前夜以前の記録は既存の切り替えに任せる。そこで前夜ぶんはその時刻で締められ、翌晩からは
  // 自動で元へ戻る（壊れるのは1晩ぶんで済む）。
  const staleNight =
    running !== null &&
    running.title.trim() === title &&
    sleepNightKey(running.startedAt, timeZone) !==
      sleepNightKey((startedAt ?? new Date()).toISOString(), timeZone);

  if (running && running.title.trim() === title && !staleNight) {
    return shortcutJson({
      ok: true,
      status: "already_running",
      startedAt: running.startedAt,
      message: `すでに${title}を記録中です（${clockLabel(running.startedAt, timeZone)}から）。`,
    });
  }

  try {
    const result = await startActivity(userId, { title, startedAt });

    // 記録中であることを通知として残す（docs/spec.md §32）。応答を待たせないのは、
    // ショートカット側の待ちがそのままオートメーションの実行時間になるため。
    after(async () => {
      try {
        await notifyActivityStarted(userId, {
          title: result.running.title,
          startedAt: new Date(result.running.startedAt),
        });
      } catch (error) {
        console.error("[dayspan] activity notification failed:", error);
      }
    });

    const startedLabel = clockLabel(result.running.startedAt, timeZone);
    // 切り替えで前の記録を予定にしたときは、そのことも添える。止め忘れていた項目が
    // 就寝の時点で締められたことを、朝に読めるようにするため。持ち越された前夜の睡眠を
    // 締めた場合は、なぜ切り替わったのかまで出す（実機で気付けるようにする）。
    const switched = !result.saved
      ? ""
      : staleNight
        ? `前夜の${title}が止まっていなかったため、${rangeLabel(result.saved, timeZone)}の予定にして切り替えました。`
        : `直前の記録を${rangeLabel(result.saved, timeZone)}の予定にしました。`;

    return shortcutJson({
      ok: true,
      status: staleNight ? "restarted" : "started",
      startedAt: result.running.startedAt,
      saved: result.saved,
      message: `${title}の記録を始めました（${startedLabel}）。${switched}${await sleepDestinationNote(userId)}`,
    });
  } catch (error) {
    return shortcutFailure("活動記録の開始", error);
  }
}
