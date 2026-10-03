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

/**
 * 送ったあとの変更（時刻の修正・削除）を探す日数（docs/spec.md §40「送ったあとの変更」）。
 *
 * 印より前に終わった睡眠も、送った履歴（`SleepHealthSent`）と突き合わせるために読む。
 * Googleへの往復は1回のままで、読む範囲だけが広がる。睡眠を直すのは「昨夜・数日前」が
 * ほとんどで、それより古い記録まで遡ると読む予定の数が増える割に、直す場面が無い。
 */
export const EDIT_LOOKBACK_DAYS = 14;

const DAY_MS = 24 * 60 * 60_000;

/** 睡眠を探す範囲の始まり。これより後に**終わった**睡眠を返す。 */
export function sleepHealthWindowStart(exportedUntil: Date | null, now: Date): Date {
  if (!exportedUntil) return new Date(now.getTime() - INITIAL_LOOKBACK_DAYS * DAY_MS);

  const floor = now.getTime() - MAX_LOOKBACK_DAYS * DAY_MS;
  return new Date(Math.max(exportedUntil.getTime(), floor));
}

/** 読むのに要るGoogleの予定の形（`GoogleEvent` の部分集合）。 */
export type SleepHealthEvent = {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
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
 * 送る対象になりうる睡眠の時間帯を読む。対象でなければ null。
 *
 * - 項目名が睡眠の項目名（`UiSetting.sleepActivityTitle`）と一致する
 * - ヘルスケアから取り込んだもの（目印付き）ではない
 * - 時刻付きで、終わりが開始より後
 */
function readSleepSpan(
  event: SleepHealthEvent,
  title: string,
): { startMs: number; endMs: number } | null {
  if ((event.summary ?? "").trim() !== title) return null;
  if (event.extendedProperties?.private?.[SLEEP_SOURCE_PROPERTY] === SLEEP_SOURCE_HEALTH) return null;

  const startIso = event.start?.dateTime;
  const endIso = event.end?.dateTime;
  // 終日の予定は時間帯を持たない。記録は必ず時刻付きで作られる（lib/sleep.ts と同じ扱い）。
  if (!startIso || !endIso) return null;

  const startMs = new Date(startIso).getTime();
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;

  return { startMs, endMs };
}

/**
 * 送る睡眠を選ぶ。
 *
 * - `readSleepSpan()` の条件を満たす時刻付きの予定
 * - 終わりが `after` より後で、`now` より前（まだ終わっていないものは送らない）
 *
 * 終わった順に並べる。ショートカットが途中で止まっても、送れたぶんが古いほうから揃う。
 * 範囲を指定して送るとき（送った履歴を見ない・issue #665）はこちらを使う。
 */
export function selectSleepForHealth(
  events: SleepHealthEvent[],
  input: { title: string; after: Date; now: Date; timeZone: string },
): SleepHealthItem[] {
  const items: SleepHealthItem[] = [];

  for (const event of events) {
    const span = readSleepSpan(event, input.title);
    if (!span) continue;
    if (span.endMs <= input.after.getTime() || span.endMs > input.now.getTime()) continue;

    items.push({
      start: toOffsetIso(new Date(span.startMs), input.timeZone),
      end: toOffsetIso(new Date(span.endMs), input.timeZone),
      endMs: span.endMs,
    });
  }

  return items.sort((a, b) => a.endMs - b.endMs);
}

/** ヘルスケアへ送った時点の時間帯（`SleepHealthSent` の1行）。 */
export type SleepHealthSentRecord = { eventId: string; start: Date; end: Date };

/** 追加で送る睡眠。どの予定のものかを持つ（送り終えたときに履歴へ書くため）。 */
export type SleepHealthPlanItem = SleepHealthItem & { eventId: string; startMs: number };

/** ヘルスケアに残っていて、利用者に消してもらう時間帯（送った時点の値）。 */
export type SleepHealthStaleItem = { eventId: string; start: string; end: string; startMs: number };

export type SleepHealthPlan = {
  /** 追加で送る睡眠（新しいもの＋時刻を直したものの変更後）。終わった順。 */
  items: SleepHealthPlanItem[];
  /** ヘルスケアに残っている古い時間帯（時刻を直した・消した・項目名を変えた睡眠の、送った時点の値）。 */
  stale: SleepHealthStaleItem[];
};

/**
 * 送る睡眠と、ヘルスケアに残る古い時間帯を求める（docs/spec.md §40「送ったあとの変更」）。
 *
 * ショートカットにはヘルスケアの既存サンプルを更新・削除するアクションが無く、追加しかできない。
 * そのため、時刻を直した睡眠は「変更後を追加で送る」ことと「送った古い時間帯を利用者に消して
 * もらう」ことの2つに分ける。
 *
 * | 送った履歴 | 予定の状態 | 結果 |
 * |---|---|---|
 * | 無い | 終わりが `after` より後 | 追加で送る（従来どおり） |
 * | 無い | 終わりが `after` 以前 | 何もしない（この仕組みより前に送った分は追跡できない） |
 * | ある | 時刻が同じ | 何もしない |
 * | ある | 時刻が違う | 変更後を送り、古い時間帯を消してもらう |
 * | ある | 削除・項目名の変更・ヘルスケア由来へ変わった | 古い時間帯を消してもらう |
 * | ある | まだ終わっていない | 何もしない（終わってから比べる） |
 *
 * 履歴のうち終わりが `editSince` 以前のものは見ない（読んだ範囲の外にあるため、予定が無いのか
 * 読んでいないのか区別できない）。
 */
export function planSleepHealthSync(
  events: SleepHealthEvent[],
  sent: SleepHealthSentRecord[],
  input: { title: string; after: Date; editSince: Date; now: Date; timeZone: string },
): SleepHealthPlan {
  const sentById = new Map(sent.map((record) => [record.eventId, record]));
  const items: SleepHealthPlanItem[] = [];
  const stale: SleepHealthStaleItem[] = [];
  /** いまも睡眠として存在する予定（終わっているかを問わない）。 */
  const alive = new Set<string>();

  const toStale = (record: SleepHealthSentRecord): SleepHealthStaleItem => ({
    eventId: record.eventId,
    start: toOffsetIso(record.start, input.timeZone),
    end: toOffsetIso(record.end, input.timeZone),
    startMs: record.start.getTime(),
  });

  for (const event of events) {
    const span = readSleepSpan(event, input.title);
    if (!span || !event.id) continue;

    alive.add(event.id);
    // まだ終わっていない睡眠は送らず、履歴があっても比べない。
    if (span.endMs > input.now.getTime()) continue;

    const record = sentById.get(event.id);
    const item: SleepHealthPlanItem = {
      eventId: event.id,
      startMs: span.startMs,
      start: toOffsetIso(new Date(span.startMs), input.timeZone),
      end: toOffsetIso(new Date(span.endMs), input.timeZone),
      endMs: span.endMs,
    };

    if (!record) {
      if (span.endMs > input.after.getTime()) items.push(item);
      continue;
    }

    const same =
      record.start.getTime() === span.startMs && record.end.getTime() === span.endMs;
    if (same) continue;

    items.push(item);
    stale.push(toStale(record));
  }

  for (const record of sent) {
    if (alive.has(record.eventId)) continue;
    if (record.end.getTime() <= input.editSince.getTime()) continue;
    stale.push(toStale(record));
  }

  return {
    items: items.sort((a, b) => a.endMs - b.endMs),
    stale: stale.sort((a, b) => a.startMs - b.startMs),
  };
}

/** 編集を探す範囲の始まり（`EDIT_LOOKBACK_DAYS` 日前）。 */
export function sleepHealthEditSince(now: Date): Date {
  return new Date(now.getTime() - EDIT_LOOKBACK_DAYS * DAY_MS);
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
