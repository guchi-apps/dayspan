import { zoneOffsetMinutes } from "@/components/calendar/datetime-fields";

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
