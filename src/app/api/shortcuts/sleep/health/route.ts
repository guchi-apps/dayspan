import {
  clockLabel,
  getShortcutTimeZone,
  resolveShortcutUserId,
  shortcutError,
  shortcutJson,
} from "@/app/api/shortcuts/shared";
import { isoToLocalInput } from "@/components/calendar/datetime-fields";
import {
  parseSleepHealthRange,
  parseSleepHealthUntil,
  SLEEP_HEALTH_UNTIL_SKIP,
  toOffsetIso,
} from "@/lib/sleep-health";
import { getSleepSettings } from "@/services/activity/settings";
import { markSleepHealthExported } from "@/services/activity/shortcut-token";
import { listSleepForHealth } from "@/services/activity/sleep";
import {
  commitPendingSleepHealth,
  savePendingSleepHealth,
} from "@/services/activity/sleep-health-sent";

/**
 * 睡眠をiPhoneのヘルスケアへ送る（docs/spec.md §40「ヘルスケアへ送る」）。
 *
 * ホーム画面のWebアプリからHealthKitへ直接書く手段は無い。書けるのはショートカットの
 * 「ヘルスケアサンプルを記録」だけなので、DaySpanはまだ送っていない睡眠を返し、
 * 書き込みはショートカットが行う。
 *
 * 2段階にする。
 *
 * 1. `GET` … 追加で送る睡眠（`items`）と、ヘルスケアに残る古い時間帯（`stale`）と、
 *    送り終えたら返してほしい `until`
 * 2. `POST { until }` … 送り終えた印と、送った履歴を進める
 *
 * GETの時点で印も履歴も進めない。ヘルスケアの書き込みを許可していない・途中で止まった、の
 * どちらでもその夜が二度と返らなくなる。書けたあとに進めれば、失敗しても次回また返る。
 *
 * 送ったあとに時刻を直した・消した睡眠は、変更後を `items` に含め、送った古い時間帯を `stale` に
 * 返す（docs/spec.md §40「送ったあとの変更」）。ショートカットにはヘルスケアの既存サンプルを
 * 更新・削除するアクションが無いため、古い時間帯は利用者がヘルスケアで消す。`stale` を読まない
 * 既存のショートカットも、`message` の案内でそれを知れる。
 *
 * クエリ `from` / `to`（`YYYY-MM-DD`）を付けると、印を見ずにその期間に終わった睡眠を返す
 * （過去の睡眠を送るための一時的な機能・issue #665）。この場合の `until` は
 * `SLEEP_HEALTH_UNTIL_SKIP` を返し、POSTはそれを受けたら印に触れない。ショートカットの
 * 「送り終えたと伝える」をそのまま流しても、通常の送信の範囲が動かないようにするため。
 * 時刻を返す形にしない理由は `SLEEP_HEALTH_UNTIL_SKIP` の説明を参照。
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

  const params = new URL(request.url).searchParams;
  const parsedRange = parseSleepHealthRange(params.get("from"), params.get("to"), { timeZone });
  if (!parsedRange.ok) return shortcutError(400, "invalid_range", parsedRange.message);
  const { range } = parsedRange;

  const result = await listSleepForHealth(userId, { now, timeZone, range: range ?? undefined });

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

  if (range) {
    const label = range.from === range.to ? range.from : `${range.from}〜${range.to}`;
    // 印は動かさない（`until` の説明は上）。
    const until = SLEEP_HEALTH_UNTIL_SKIP;

    if (!last) {
      return shortcutJson({
        ok: true,
        status: "none",
        count: 0,
        items: [],
        stale: [],
        until,
        message: `${label}に終わった${title}はありません。`,
      });
    }

    return shortcutJson({
      ok: true,
      status: "pending",
      count: items.length,
      items,
      stale: [],
      until,
      // 最大31件になるため、通常の送信のように時間帯は並べない。
      message: `${label}に終わった${title}を${items.length}件ヘルスケアへ送ります。`,
    });
  }

  const plan = result.plan;
  // 時刻を直した睡眠が混ざるため、最後の要素の終わりが印より前のこともある。印は戻らないので
  // そのまま返してよい（`markSleepHealthExported()`）。
  const until = last
    ? // 秒で切った `items` の値ではなく元の時刻を返す。切った値を印にすると、印が
      // ミリ秒ぶん手前に来て、送り終えた睡眠が次の実行でもう一度返る。
      new Date(last.endMs).toISOString()
    : // 何も送らないときも POST へそのまま流せるよう値は返すが、いまではなく探した範囲の
      // 始まりにする（印は実質動かない）。いまにすると、あとから過去の時刻で止めた睡眠
      // （止め忘れて終了時刻を指定したもの）が印より前に終わった扱いになり、送られない。
      result.after.toISOString();

  // 送り終えたと伝えられたとき（POST）に履歴へ反映する控えを置く。送るものも整理するものも
  // 無ければ控えは消える。
  if (plan) {
    await savePendingSleepHealth(userId, { plan, until, pruneBefore: result.editSince });
  }

  const stale = result.stale.map(({ start, end }) => ({ start, end }));
  const staleNote = staleMessage(stale, timeZone);

  if (!last) {
    return shortcutJson({
      ok: true,
      status: stale.length > 0 ? "stale_only" : "none",
      count: 0,
      items: [],
      stale,
      until,
      message:
        stale.length > 0
          ? `ヘルスケアへ新しく送る${title}はありません。${staleNote}`
          : `ヘルスケアへ送る${title}はありません。`,
    });
  }

  const sending = items
    .map((item) => `${clockLabel(item.start, timeZone)}〜${clockLabel(item.end, timeZone)}`)
    .join("、");

  return shortcutJson({
    ok: true,
    status: "pending",
    count: items.length,
    items,
    stale,
    until,
    message: `${title}を${items.length}件ヘルスケアへ送ります（${sending}）。${staleNote}`,
  });
}

/**
 * ヘルスケアに残る古い時間帯の案内。
 *
 * 時刻を直した睡眠は、変更後を追加で送るだけでは古い時間帯がヘルスケアに残り、同じ夜が2件並ぶ。
 * 消せるのは利用者だけなので、時間帯を示して頼む。日付も添える（直すのは数日前のこともあり、
 * 時刻だけではどの夜か分からない）。
 */
function staleMessage(stale: { start: string; end: string }[], timeZone: string): string {
  if (stale.length === 0) return "";

  const labels = stale
    .map(({ start, end }) => {
      const startLabel = isoToLocalInput(start, timeZone);
      return `${startLabel.slice(5, 10).replace("-", "/")} ${startLabel.slice(11)}〜${clockLabel(end, timeZone)}`;
    })
    .join("、");

  return `ヘルスケアには送ったときの時間帯が残っています。睡眠分析から削除してください（${labels}）。`;
}

type PostBody = { until?: unknown };

export async function POST(request: Request) {
  const auth = await resolveShortcutUserId(request);
  if (!auth.ok) return auth.response;

  const { userId } = auth;

  const body = ((await request.json().catch(() => ({}))) ?? {}) as PostBody;

  // 範囲を指定して送ったときの応答（GET）が返した合図。印は動かさない。
  if (body.until === SLEEP_HEALTH_UNTIL_SKIP) {
    return shortcutJson({
      ok: true,
      status: "skipped",
      exportedUntil: null,
      message: "範囲を指定して送ったため、送り終えた印は動かしていません。",
    });
  }

  const parsed = parseSleepHealthUntil(body.until, new Date());
  if (!parsed.ok) return shortcutError(400, "invalid_until", parsed.message);

  const [exportedUntil, timeZone] = await Promise.all([
    markSleepHealthExported(userId, parsed.until),
    getShortcutTimeZone(userId),
  ]);
  // 送った履歴も同じ `until` で進める（一致する控えが無ければ何もしない）。
  await commitPendingSleepHealth(userId, parsed.until);

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
