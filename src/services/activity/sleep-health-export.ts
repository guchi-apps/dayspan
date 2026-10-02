import { isoToLocalInput } from "@/components/calendar/datetime-fields";
import { db } from "@/lib/db";
import {
  parseSleepHealthUntil,
  SLEEP_HEALTH_UNTIL_SKIP,
  toOffsetIso,
  type SleepHealthRange,
} from "@/lib/sleep-health";
import { getSleepSettings } from "@/services/activity/settings";
import { markSleepHealthExported } from "@/services/activity/shortcut-token";
import { listSleepForHealth } from "@/services/activity/sleep";
import {
  commitPendingSleepHealth,
  savePendingSleepHealth,
} from "@/services/activity/sleep-health-sent";

/**
 * 睡眠をヘルスケアへ送るための取得と確定（docs/spec.md §40「ヘルスケアへ送る」）。
 *
 * ショートカット経路（`/api/shortcuts/sleep/health`・トークン認証）とiOSアプリの経路
 * （`/api/sleep/health`・セッション認証）が共有する。違うのは認証と応答の包み方だけで、
 * 何を送るか・印と履歴をいつ進めるかはここに1つだけ持つ。
 *
 * 取得（`loadSleepHealthExport`）では印も履歴も進めない。書き終えたあとの確定
 * （`commitSleepHealthExport`）でだけ進める。取得の時点で進めると、ヘルスケアの書き込みを
 * 許可していない・途中で止まったときに、その夜が二度と返らなくなる。
 *
 * 送ったあとに時刻を直した・消した睡眠は、変更後を `items` に含め、送った古い時間帯を `stale` に
 * 返す（§40「送ったあとの変更」）。
 */

export type SleepHealthExportBody = { message: string } & Record<string, unknown>;

export type SleepHealthExportResult =
  | { ok: true; body: SleepHealthExportBody }
  | { ok: false; status: number; error: string; message: string };

async function getTimeZone(userId: string): Promise<string> {
  const setting = await db.uiSetting.findUnique({ where: { userId }, select: { timeZone: true } });
  return setting?.timeZone ?? "Asia/Tokyo";
}

export { getTimeZone as getSleepHealthTimeZone };

function clockLabel(iso: string, timeZone: string): string {
  return isoToLocalInput(iso, timeZone).slice(11);
}

/**
 * 追加で送る睡眠・ヘルスケアに残る古い時間帯・送り終えたら返してほしい `until` を返す。
 *
 * `range`（過去の日を指定して送る一時的な機能・issue #665）はショートカット経路だけが渡す。
 * この場合の `until` は `SLEEP_HEALTH_UNTIL_SKIP` で、確定は印に触れない。
 */
export async function loadSleepHealthExport(
  userId: string,
  input: { now: Date; timeZone: string; range?: SleepHealthRange | null },
): Promise<SleepHealthExportResult> {
  const { now, timeZone } = input;
  const range = input.range ?? null;
  const { title } = await getSleepSettings(userId);

  const result = await listSleepForHealth(userId, { now, timeZone, range: range ?? undefined });

  if (!result.ok) {
    if (result.reason === "calendar_not_selected") {
      return {
        ok: false,
        status: 409,
        error: "calendar_not_selected",
        message:
          "活動記録の保存先カレンダーが未指定のため、どれが睡眠の記録か区別できません。設定 ▸ 活動記録 で選んでください。",
      };
    }
    return {
      ok: false,
      status: 502,
      error: "google_request_failed",
      message: result.message ?? "睡眠の記録を取得できませんでした。",
    };
  }

  const items = result.items.map(({ start, end }) => ({ start, end }));
  const last = result.items[result.items.length - 1];

  if (range) {
    const label = range.from === range.to ? range.from : `${range.from}〜${range.to}`;
    // 印は動かさない（`until` の説明は `SLEEP_HEALTH_UNTIL_SKIP`）。
    const until = SLEEP_HEALTH_UNTIL_SKIP;

    if (!last) {
      return {
        ok: true,
        body: {
          ok: true,
          status: "none",
          count: 0,
          items: [],
          stale: [],
          until,
          message: `${label}に終わった${title}はありません。`,
        },
      };
    }

    return {
      ok: true,
      body: {
        ok: true,
        status: "pending",
        count: items.length,
        items,
        stale: [],
        until,
        // 最大31件になるため、通常の送信のように時間帯は並べない。
        message: `${label}に終わった${title}を${items.length}件ヘルスケアへ送ります。`,
      },
    };
  }

  const plan = result.plan;
  // 時刻を直した睡眠が混ざるため、最後の要素の終わりが印より前のこともある。印は戻らないので
  // そのまま返してよい（`markSleepHealthExported()`）。
  const until = last
    ? // 秒で切った `items` の値ではなく元の時刻を返す。切った値を印にすると、印が
      // ミリ秒ぶん手前に来て、送り終えた睡眠が次の実行でもう一度返る。
      new Date(last.endMs).toISOString()
    : // 何も送らないときも確定へそのまま流せるよう値は返すが、いまではなく探した範囲の
      // 始まりにする（印は実質動かない）。いまにすると、あとから過去の時刻で止めた睡眠
      // （止め忘れて終了時刻を指定したもの）が印より前に終わった扱いになり、送られない。
      result.after.toISOString();

  // 送り終えたと伝えられたときに履歴へ反映する控えを置く。送るものも整理するものも
  // 無ければ控えは消える。
  if (plan) {
    await savePendingSleepHealth(userId, { plan, until, pruneBefore: result.editSince });
  }

  const stale = result.stale.map(({ start, end }) => ({ start, end }));
  const staleNote = staleMessage(stale, timeZone);

  if (!last) {
    return {
      ok: true,
      body: {
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
      },
    };
  }

  const sending = items
    .map((item) => `${clockLabel(item.start, timeZone)}〜${clockLabel(item.end, timeZone)}`)
    .join("、");

  return {
    ok: true,
    body: {
      ok: true,
      status: "pending",
      count: items.length,
      items,
      stale,
      until,
      message: `${title}を${items.length}件ヘルスケアへ送ります（${sending}）。${staleNote}`,
    },
  };
}

/**
 * ヘルスケアに残る古い時間帯の案内。
 *
 * 時刻を直した睡眠は、変更後を追加で送るだけでは古い時間帯がヘルスケアに残り、同じ夜が2件並ぶ。
 * ショートカットでは消せるのは利用者だけなので、時間帯を示して頼む。日付も添える（直すのは数日前の
 * こともあり、時刻だけではどの夜か分からない）。iOSアプリは自分が書いた分を消し、消せなかった
 * 分だけをこの文面で案内する。
 */
export function staleMessage(stale: { start: string; end: string }[], timeZone: string): string {
  if (stale.length === 0) return "";

  const labels = stale
    .map(({ start, end }) => {
      const startLabel = isoToLocalInput(start, timeZone);
      return `${startLabel.slice(5, 10).replace("-", "/")} ${startLabel.slice(11)}〜${clockLabel(end, timeZone)}`;
    })
    .join("、");

  return `ヘルスケアには送ったときの時間帯が残っています。睡眠分析から削除してください（${labels}）。`;
}

/** 送り終えたと伝えられたとき（確定）。印と送った履歴を進める。 */
export async function commitSleepHealthExport(
  userId: string,
  untilValue: unknown,
  timeZone: string,
): Promise<SleepHealthExportResult> {
  // 範囲を指定して送ったときの応答（取得）が返した合図。印は動かさない。
  if (untilValue === SLEEP_HEALTH_UNTIL_SKIP) {
    return {
      ok: true,
      body: {
        ok: true,
        status: "skipped",
        exportedUntil: null,
        message: "範囲を指定して送ったため、送り終えた印は動かしていません。",
      },
    };
  }

  const parsed = parseSleepHealthUntil(untilValue, new Date());
  if (!parsed.ok) {
    return { ok: false, status: 400, error: "invalid_until", message: parsed.message };
  }

  const exportedUntil = await markSleepHealthExported(userId, parsed.until);
  // 送った履歴も同じ `until` で進める（一致する控えが無ければ何もしない）。
  await commitPendingSleepHealth(userId, parsed.until);

  const label = exportedUntil
    ? isoToLocalInput(exportedUntil.toISOString(), timeZone).replace("T", " ")
    : null;

  return {
    ok: true,
    body: {
      ok: true,
      status: "marked",
      exportedUntil: exportedUntil ? toOffsetIso(exportedUntil, timeZone) : null,
      message: label
        ? `ヘルスケアへの送信を記録しました（${label}までに終わった睡眠は次から送りません）。`
        : "ヘルスケアへの送信を記録しました。",
    },
  };
}
