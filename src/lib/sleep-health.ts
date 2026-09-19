import { localInputToIso, zoneOffsetMinutes } from "@/components/calendar/datetime-fields";
import { addDays, dateKeyDiffDays, isRealDateKey, parseDateKey, toDateKey } from "@/lib/calendar-range";

/**
 * 睡眠をiPhoneのヘルスケアへ送るための絞り込み（docs/spec.md §40「ヘルスケアへ送る」）。
 *
 * ホーム画面のWebアプリからHealthKitへ直接書く手段は無く、書けるのはショートカットの
 * 「ヘルスケアサンプルを記録」だけ。DaySpanは「まだ送っていない睡眠」を渡し、書き込みは
 * ショートカットが行う。ここは外部I/Oを持たない部分だけを置く（回帰テストを書けるように）。
 */

/**
 * ヘルスケアから取り込んだ予定に付ける目印（Googleの `extendedProperties.private`）。
 *
 * 付けないと、ヘルスケア → DaySpan で取り込んだ睡眠が、DaySpan → ヘルスケアで
 * ショートカットを出どころとする2件目として戻る。
 */
export const SLEEP_SOURCE_PROPERTY = "dayspanSource";
export const SLEEP_SOURCE_HEALTH = "health";

/**
 * まだ一度も送っていないときに遡る日数。
 *
 * 過去の睡眠を一度に数十件流し込むと、Apple Watchで入っている夜とまとめて重なり、
 * しかもヘルスケア側で消すのは1件ずつになる。起床後に送る使い方なら昨夜ぶんで足りる。
 */
export const INITIAL_LOOKBACK_DAYS = 2;

/**
 * 送り終えた印が古いときに遡る上限。しばらく送っていなかった場合でも、読む範囲
 * （Google 1往復）を膨らませない。
 */
export const MAX_LOOKBACK_DAYS = 30;

const DAY_MS = 24 * 60 * 60_000;

/** 睡眠を探す範囲の始まり。これより後に**終わった**睡眠を返す。 */
export function sleepHealthWindowStart(exportedUntil: Date | null, now: Date): Date {
  if (!exportedUntil) return new Date(now.getTime() - INITIAL_LOOKBACK_DAYS * DAY_MS);

  const floor = now.getTime() - MAX_LOOKBACK_DAYS * DAY_MS;
  return new Date(Math.max(exportedUntil.getTime(), floor));
}

/** 読むのに要るGoogleの予定の形（`GoogleEvent` の部分集合）。 */
export type SleepHealthEvent = {
  summary?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  extendedProperties?: { private?: Record<string, string> };
};

export type SleepHealthItem = {
  /** 利用者のタイムゾーンのオフセット付きISO（`2026-09-18T23:35:00+09:00`）。 */
  start: string;
  end: string;
  /** 並べ替え・印の計算用（ミリ秒）。応答には出さない。 */
  endMs: number;
};

/**
 * 送る睡眠を選ぶ。
 *
 * - 項目名が睡眠の項目名（`UiSetting.sleepActivityTitle`）と一致する時刻付きの予定
 * - ヘルスケアから取り込んだもの（目印付き）は除く
 * - 終わりが `after` より後で、`now` より前（まだ終わっていないものは送らない）
 *
 * 終わった順に並べる。ショートカットが途中で止まっても、送れたぶんが古いほうから揃う。
 */
export function selectSleepForHealth(
  events: SleepHealthEvent[],
  input: { title: string; after: Date; now: Date; timeZone: string },
): SleepHealthItem[] {
  const items: SleepHealthItem[] = [];

  for (const event of events) {
    if ((event.summary ?? "").trim() !== input.title) continue;
    if (event.extendedProperties?.private?.[SLEEP_SOURCE_PROPERTY] === SLEEP_SOURCE_HEALTH) continue;

    const startIso = event.start?.dateTime;
    const endIso = event.end?.dateTime;
    // 終日の予定は時間帯を持たない。記録は必ず時刻付きで作られる（lib/sleep.ts と同じ扱い）。
    if (!startIso || !endIso) continue;

    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;
    if (endMs <= input.after.getTime() || endMs > input.now.getTime()) continue;

    items.push({
      start: toOffsetIso(new Date(startMs), input.timeZone),
      end: toOffsetIso(new Date(endMs), input.timeZone),
      endMs,
    });
  }

  return items.sort((a, b) => a.endMs - b.endMs);
}

/**
 * 利用者のタイムゾーンのオフセット付きISO（秒まで）。
 *
 * ショートカットの「日付を取得」はオフセット付きの文字列をそのまま日時として読む。
 * UTC（`Z`）で渡しても読めるが、通知や「クイックルック」で中身を確かめたときに
 * 9時間ずれた数字が出て、正しく送れているのかを実機で判断できない。
 */
export function toOffsetIso(date: Date, timeZone: string): string {
  const offset = Math.round(zoneOffsetMinutes(date, timeZone));
  const local = new Date(date.getTime() + offset * 60_000).toISOString().slice(0, 19);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${local}${sign}${hh}:${mm}`;
}

/** 未来の印として受ける猶予。端末の時計のずれを見込む（`resolveRecordTime()` と同じ60秒）。 */
const FUTURE_TOLERANCE_MS = 60_000;

export type SleepHealthUntilParseResult =
  | { ok: true; until: Date }
  | { ok: false; message: string };

/**
 * `POST` の本文の `until`（GETで返した値）を読む。
 *
 * 未来は断る。印が未来へ進むと、それまでに終わる睡眠が二度と返らなくなる。
 */
export function parseSleepHealthUntil(value: unknown, now: Date): SleepHealthUntilParseResult {
  if (typeof value !== "string" || value.trim() === "") {
    return {
      ok: false,
      message:
        "until がありません。直前の「URLの内容を取得」で受け取った until をそのまま送ってください。",
    };
  }

  const until = new Date(value);
  if (Number.isNaN(until.getTime())) {
    return { ok: false, message: "until の日時が読めませんでした。ISO 8601 の形式で送ってください。" };
  }
  if (until.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    return { ok: false, message: "until に未来の日時は指定できません。" };
  }

  return { ok: true, until };
}

/**
 * 範囲指定で一度に送れる日数の上限。
 *
 * Googleへの往復は範囲の広さによらず1回だが、ヘルスケアへ書いたものを消すのは1件ずつに
 * なる。取り違えた範囲を送ったときの後始末を、1か月ぶん（31件）までに収める。
 */
export const MAX_RANGE_DAYS = 31;

/**
 * 範囲指定で送ったときに `GET` が `until` として返す合図。`POST` はこれを受けたら印に触れない。
 *
 * 印を進める値を返すと、印がまだ無い（`null`）とき、その値が新しく印として保存され、通常の
 * 送信の起点が「範囲を送った日の2日前」へ固定される（issue #665 計画レビューG1）。値を返さない
 * （空にする）形にしないのは、ショートカットが取り出した値をそのまま流すため、空だと通常の送信で
 * `until` を付け忘れた設定ミスと見分けが付かず、`invalid_until` の案内が出せなくなるから。
 */
export const SLEEP_HEALTH_UNTIL_SKIP = "skip";

export type SleepHealthRange = {
  /** 範囲の始まり（`from` の0:00）。これより後に終わった睡眠を返す。 */
  after: Date;
  /** 範囲の終わり（`to` の翌0:00）。 */
  before: Date;
  /** 画面・通知に出す日付（`from`・`to` そのまま）。 */
  from: string;
  to: string;
};

export type SleepHealthRangeParseResult =
  | { ok: true; range: SleepHealthRange | null }
  | { ok: false; message: string };

/**
 * `GET` のクエリ `from` / `to`（`YYYY-MM-DD`）を読む。一時的な機能のため、印を使う通常の
 * 送信とは別に、過去の日を指定して送れるようにする（docs/spec.md §40）。
 *
 * - 両方無ければ `range: null`（通常の送信）
 * - 睡眠は起床した日（終わった日）で数える。`from` の0:00より後〜`to` の翌0:00までに終わったもの
 * - 未来の日付は断らない（`now` より後に終わるものは `selectSleepForHealth()` が外す）
 */
export function parseSleepHealthRange(
  from: string | null,
  to: string | null,
  input: { timeZone: string },
): SleepHealthRangeParseResult {
  const fromKey = from?.trim() ?? "";
  const toKey = to?.trim() ?? "";

  if (!fromKey && !toKey) return { ok: true, range: null };

  if (!fromKey || !toKey) {
    return {
      ok: false,
      message: "過去の睡眠を送るには from と to の両方（YYYY-MM-DD）を指定してください。",
    };
  }
  if (!isRealDateKey(fromKey) || !isRealDateKey(toKey)) {
    return { ok: false, message: "from と to は YYYY-MM-DD の形の日付で指定してください。" };
  }

  const days = dateKeyDiffDays(fromKey, toKey) + 1;
  if (days < 1) return { ok: false, message: "from は to と同じ日か、それより前にしてください。" };
  if (days > MAX_RANGE_DAYS) {
    return {
      ok: false,
      message: `一度に送れるのは${MAX_RANGE_DAYS}日までです（指定は${days}日）。範囲を分けてください。`,
    };
  }

  const nextKey = toDateKey(addDays(parseDateKey(toKey), 1));

  return {
    ok: true,
    range: {
      after: new Date(localInputToIso(`${fromKey}T00:00`, input.timeZone)),
      before: new Date(localInputToIso(`${nextKey}T00:00`, input.timeZone)),
      from: fromKey,
      to: toKey,
    },
  };
}
