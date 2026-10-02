import {
  getShortcutTimeZone,
  resolveShortcutUserId,
  shortcutError,
  shortcutJson,
} from "@/app/api/shortcuts/shared";
import { parseSleepHealthRange } from "@/lib/sleep-health";
import {
  commitSleepHealthExport,
  loadSleepHealthExport,
  type SleepHealthExportResult,
} from "@/services/activity/sleep-health-export";

/**
 * 睡眠をiPhoneのヘルスケアへ送る（docs/spec.md §40「ヘルスケアへ送る」）。
 *
 * ホーム画面のWebアプリからHealthKitへ直接書く手段は無い。書けるのはショートカットの
 * 「ヘルスケアサンプルを記録」だけなので、DaySpanはまだ送っていない睡眠を返し、
 * 書き込みはショートカットが行う。
 *
 * 取得と確定の本体は `services/activity/sleep-health-export.ts`（iOSアプリの `/api/sleep/health` と共有）。
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
  const timeZone = await getShortcutTimeZone(userId);

  const params = new URL(request.url).searchParams;
  const parsedRange = parseSleepHealthRange(params.get("from"), params.get("to"), { timeZone });
  if (!parsedRange.ok) return shortcutError(400, "invalid_range", parsedRange.message);

  const result = await loadSleepHealthExport(userId, {
    now: new Date(),
    timeZone,
    range: parsedRange.range,
  });
  return respond(result);
}

type PostBody = { until?: unknown };

export async function POST(request: Request) {
  const auth = await resolveShortcutUserId(request);
  if (!auth.ok) return auth.response;

  const { userId } = auth;
  const body = ((await request.json().catch(() => ({}))) ?? {}) as PostBody;

  const result = await commitSleepHealthExport(userId, body.until, await getShortcutTimeZone(userId));
  return respond(result);
}

function respond(result: SleepHealthExportResult) {
  return result.ok ? shortcutJson(result.body) : shortcutError(result.status, result.error, result.message);
}
