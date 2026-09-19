import {
  clockLabel,
  getShortcutTimeZone,
  resolveShortcutUserId,
  shortcutError,
  shortcutJson,
} from "@/app/api/shortcuts/shared";
import { isoToLocalInput } from "@/components/calendar/datetime-fields";
import { parseSleepHealthUntil, toOffsetIso } from "@/lib/sleep-health";
import { getSleepSettings } from "@/services/activity/settings";
import { markSleepHealthExported } from "@/services/activity/shortcut-token";
import { listSleepForHealth } from "@/services/activity/sleep";

/**
 * 睡眠をiPhoneのヘルスケアへ送る（docs/spec.md §40「ヘルスケアへ送る」）。
 *
 * ホーム画面のWebアプリからHealthKitへ直接書く手段は無い。書けるのはショートカットの
 * 「ヘルスケアサンプルを記録」だけなので、DaySpanはまだ送っていない睡眠を返し、
 * 書き込みはショートカットが行う。
 *
 * 2段階にする。
 *
 * 1. `GET` … まだ送っていない睡眠（`items`）と、送り終えたら返してほしい `until`
 * 2. `POST { until }` … 送り終えた印を進める
 *
 * GETの時点で印を進めない。ヘルスケアの書き込みを許可していない・途中で止まった、の
 * どちらでもその夜が二度と返らなくなる。書けたあとに進めれば、失敗しても次回また返る。
 */
export async function GET(request: Request) {
  const auth = await resolveShortcutUserId(request);
  if (!auth.ok) return auth.response;

  const { userId } = auth;
  const now = new Date();

  const [{ title }, timeZone] = await Promise.all([
    getSleepSettings(userId),
    getShortcutTimeZone(userId),
  ]);

  const result = await listSleepForHealth(userId, { now, timeZone });

  if (!result.ok) {
    if (result.reason === "calendar_not_selected") {
      return shortcutError(
        409,
        "calendar_not_selected",
        "活動記録の保存先カレンダーが未指定のため、どれが睡眠の記録か区別できません。設定 ▸ 活動記録 で選んでください。",
      );
    }
    return shortcutError(502, "google_request_failed", result.message ?? "睡眠の記録を取得できませんでした。");
  }

  const items = result.items.map(({ start, end }) => ({ start, end }));
  const last = result.items[result.items.length - 1];

  if (!last) {
    return shortcutJson({
      ok: true,
      status: "none",
      count: 0,
      items: [],
      // 何も送らないときも POST へそのまま流せるよう値は返すが、いまではなく探した範囲の
      // 始まりにする（印は実質動かない）。いまにすると、あとから過去の時刻で止めた睡眠
      // （止め忘れて終了時刻を指定したもの）が印より前に終わった扱いになり、送られない。
      until: result.after.toISOString(),
      message: `ヘルスケアへ送る${title}はありません。`,
    });
  }

  return shortcutJson({
    ok: true,
    status: "pending",
    count: items.length,
    items,
    // 秒で切った `items` の値ではなく元の時刻を返す。切った値を印にすると、印が
    // ミリ秒ぶん手前に来て、送り終えた睡眠が次の実行でもう一度返る。
    until: new Date(last.endMs).toISOString(),
    message: `${title}を${items.length}件ヘルスケアへ送ります（${items
      .map((item) => `${clockLabel(item.start, timeZone)}〜${clockLabel(item.end, timeZone)}`)
      .join("、")}）。`,
  });
}

type PostBody = { until?: unknown };

export async function POST(request: Request) {
  const auth = await resolveShortcutUserId(request);
  if (!auth.ok) return auth.response;

  const { userId } = auth;

  const body = ((await request.json().catch(() => ({}))) ?? {}) as PostBody;

  const parsed = parseSleepHealthUntil(body.until, new Date());
  if (!parsed.ok) return shortcutError(400, "invalid_until", parsed.message);

  const [exportedUntil, timeZone] = await Promise.all([
    markSleepHealthExported(userId, parsed.until),
    getShortcutTimeZone(userId),
  ]);

  const label = exportedUntil
    ? isoToLocalInput(exportedUntil.toISOString(), timeZone).replace("T", " ")
    : null;

  return shortcutJson({
    ok: true,
    status: "marked",
    exportedUntil: exportedUntil ? toOffsetIso(exportedUntil, timeZone) : null,
    message: label
      ? `ヘルスケアへの送信を記録しました（${label}までに終わった睡眠は次から送りません）。`
      : "ヘルスケアへの送信を記録しました。",
  });
}
