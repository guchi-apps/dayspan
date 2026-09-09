/**
 * iPhoneショートカットから受け取る睡眠の時間帯の読み取り（docs/spec.md §40）。
 *
 * DB・外部APIには触れない純粋な計算にしてある（`lib/sleep.ts` と同じ立ち位置）。
 * ヘルスケアの睡眠分析から組み立てる本文は端末側のショートカットが作るもので、
 * こちらからは直せない。受け取れる形が3通りあり、どれをどう読むかは取得と切り離して
 * 確かめられる形にしておく。
 */

/** 記録として受け付ける長さの上限（分）。1回の睡眠が24時間を超えることはない。 */
export const MAX_SLEEP_MINUTES = 24 * 60;

/** 受け取る本文。ショートカットが作るJSONは型が保証されないため、すべて unknown で受ける。 */
export type SleepRangeBody = {
  start?: unknown;
  end?: unknown;
  minutes?: unknown;
};

export type SleepRangeParseResult =
  | { ok: true; start: Date; end: Date }
  | { ok: false; message: string };

/**
 * 本文から睡眠の時間帯を決める。
 *
 * 受け付ける形は3通り。
 *
 * - `{ start, end }` … ヘルスケアの睡眠分析の開始・終了をそのまま送る場合
 * - `{ end, minutes }` … 起床時刻と実測の睡眠時間を送る場合
 * - `{ minutes }` … 起きた直後に、睡眠時間だけを送る場合（終わりは「いま」）
 *
 * `minutes` だけの形で終わりを「いま」にするのは、この本文を送るのが起床後だから。
 * 開始時刻を端末側で計算させると、ショートカットの中に日付の引き算が1つ増える。
 *
 * 未来かどうかはここでは見ない。判定は活動記録の他の経路と同じ `resolveRecordTime()`
 * （`services/activity/running.ts`）に通す。写しを置くと、片方だけ規則が変わる。
 */
export function parseSleepRangeBody(body: SleepRangeBody, now: Date): SleepRangeParseResult {
  const hasMinutes = body.minutes !== undefined && body.minutes !== null;
  const hasStart = isPresent(body.start);
  const hasEnd = isPresent(body.end);

  if (!hasMinutes && !(hasStart && hasEnd)) {
    return {
      ok: false,
      message:
        "睡眠の時間帯が読めませんでした。start と end、または minutes を送ってください。",
    };
  }

  const end = hasEnd ? parseDate(body.end) : now;
  if (!end) {
    return { ok: false, message: "end の日時が読めませんでした。ISO 8601 の形式で送ってください。" };
  }

  // start と minutes の両方が来たときは start を採る。実測値のほうが、長さから逆算した
  // 開始時刻より確からしい（丸めも入らない）。
  if (hasStart) {
    const start = parseDate(body.start);
    if (!start) {
      return {
        ok: false,
        message: "start の日時が読めませんでした。ISO 8601 の形式で送ってください。",
      };
    }
    if (start.getTime() >= end.getTime()) {
      return { ok: false, message: "start が end 以降になっています。" };
    }

    return { ok: true, start, end };
  }

  const minutes = parseMinutes(body.minutes);
  if (minutes === null) {
    return {
      ok: false,
      message: `minutes は 1〜${MAX_SLEEP_MINUTES} の整数（分）で送ってください。`,
    };
  }

  return { ok: true, start: new Date(end.getTime() - minutes * 60_000), end };
}

/** 時間帯（ミリ秒）。重なりの判定に使う。 */
export type SleepSpan = { start: number; end: number };

/**
 * すでにある睡眠のうち、送られてきた時間帯と重なる最初のものを返す。無ければ null。
 *
 * オートメーションは条件が揃えば何度でも走る。同じ夜の睡眠が2件並ぶと、
 * `/activity/sleep` の平均も目標に届かなかった夜の数も倍で出る（docs/spec.md §39）。
 *
 * 真偽ではなく重なった相手を返すのは、応答のメッセージに「いつの睡眠と重なったのか」を
 * 出すため。呼び出し側で探し直すと、重なりの規則が2か所に分かれる。
 *
 * 半開区間で見る。前の睡眠の終わりと次の始まりがちょうど同じ時刻（連続して2回に分けて
 * 記録した夜）は重なりにしない。
 */
export function findOverlappingSleepSpan<T extends SleepSpan>(
  range: SleepSpan,
  spans: T[],
): T | null {
  return spans.find((span) => span.start < range.end && range.start < span.end) ?? null;
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 睡眠時間（分）として読む。
 *
 * ショートカットの「辞書」は数値を文字列として渡すことがあるため、数字だけの文字列も受ける。
 * 小数（Apple Watchの秒単位の値を60で割った結果）は分へ丸める。
 */
function parseMinutes(value: unknown): number | null {
  const numeric = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric)) return null;

  const minutes = Math.round(numeric);
  if (minutes < 1 || minutes > MAX_SLEEP_MINUTES) return null;

  return minutes;
}
