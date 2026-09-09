import {
  getShortcutTimeZone,
  rangeLabel,
  resolveShortcutUserId,
  shortcutError,
  shortcutFailure,
  shortcutJson,
  sleepDestinationNote,
} from "@/app/api/shortcuts/shared";
import { parseSleepRangeBody, type SleepRangeBody } from "@/lib/sleep-shortcut";
import { recordSleepRange } from "@/services/activity/sleep";
import { getSleepSettings } from "@/services/activity/settings";

/**
 * ヘルスケアの睡眠分析（Apple Watch等の実測値）を起床後にまとめて記録する（docs/spec.md §40）。
 *
 * 就寝時・アラームのオートメーション（`/start`・`/stop`）が「押した時点」を記録するのに対し、
 * こちらは**すでに終わった時間帯**をそのまま予定にする。進行中の記録は経由しない。
 *
 * 受け付ける本文は3通り（`lib/sleep-shortcut.ts`）。
 *
 * - `{ start, end }` … 睡眠分析の開始・終了をそのまま送る
 * - `{ end, minutes }` … 起床時刻と実測の睡眠時間
 * - `{ minutes }` … 睡眠時間だけ（終わりは「いま」）
 *
 * 同じ時間帯の睡眠がすでにあれば作らない。オートメーションは条件が揃えば何度でも走るため、
 * 確かめずに作ると同じ夜の睡眠が2件並ぶ（docs/spec.md §39 の平均も目標未満の夜も倍で出る）。
 */
export async function POST(request: Request) {
  const auth = await resolveShortcutUserId(request);
  if (!auth.ok) return auth.response;

  const { userId } = auth;

  const body = ((await request.json().catch(() => ({}))) ?? {}) as SleepRangeBody;

  const parsed = parseSleepRangeBody(body, new Date());
  if (!parsed.ok) {
    return shortcutError(400, "invalid_range", parsed.message);
  }

  const [{ title }, timeZone] = await Promise.all([
    getSleepSettings(userId),
    getShortcutTimeZone(userId),
  ]);

  try {
    const result = await recordSleepRange(userId, { start: parsed.start, end: parsed.end });

    if (result.status === "overlapping") {
      return shortcutJson({
        ok: true,
        status: "overlapping",
        existing: result.existing,
        message: `すでに${rangeLabel(result.existing, timeZone)}の${title}があるため、追加しませんでした。`,
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
