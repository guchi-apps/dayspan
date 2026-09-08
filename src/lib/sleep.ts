import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { dateKeyDiffDays } from "@/lib/calendar-range";
import type { GoogleEvent } from "@/services/google-calendar/events";

/**
 * 睡眠の横通し表示の計算（docs/spec.md §39）。
 *
 * DB・外部APIには触れない純粋な計算にしてある（`services/activity/totals.ts` と同じ立ち位置）。
 * 行の境界と切り詰めが絡み合うため、取得と切り離して確かめられる形にしておく。
 */

/** 1晩の目標睡眠時間の既定（分）。設定で変えられる。 */
export const DEFAULT_SLEEP_TARGET_MINUTES = 420;

/**
 * 並べられる夜の数。14日は2週間ぶんの並び、30日はひと月ぶんの傾きを見るため。
 *
 * 画面（"use client"）ではなくここに置く。サーバーコンポーネント（page.tsx）が
 * URLの `?days=` を判定するのに読むため、クライアント境界の向こう側に置かない。
 */
export const SLEEP_RANGE_DAYS = [14, 30] as const;

/** 睡眠として数える項目名の既定。活動記録の初期項目（DEFAULT_ACTIVITY_NAMES）の先頭と同じ。 */
export const DEFAULT_SLEEP_TITLE = "睡眠";

/** 1行の長さ（分）。24時間。 */
export const MINUTES_PER_NIGHT = 24 * 60;

/**
 * 1行の始まり（その日の0時から数えた分）。12:00。
 *
 * 0時で区切ると、いま解こうとしている分断（睡眠が日付で割れる）がそのまま行の分断として
 * 戻ってくる。18:00起点の18時間軸にすると通常の睡眠は収まるが、昼寝が軸から落ちる。
 * 正午で切って24時間を通せば、記録を1件も捨てずに1晩を1行へ収められる。
 *
 * 引き換えに、10:00〜15:00 のように昼をまたぐ睡眠は2行に分かれる。
 */
export const NIGHT_START_MINUTES = 12 * 60;

/** 1行の中で睡眠が占める帯。`from` / `to` はその行の12:00から数えた分（0〜1440）。 */
export type SleepSegment = {
  from: number;
  to: number;
  /** まだ止めていない記録。行の右端ではなく現在時刻で終わっている。 */
  running: boolean;
};

/** 1晩ぶんの行。 */
export type SleepNight = {
  /** 行の始まり（12:00）が属する日付キー。「9/7の夜」の 9/7。 */
  dateKey: string;
  segments: SleepSegment[];
  /** その行に入った睡眠の合計（分）。 */
  minutes: number;
  /** 行の終わり（翌12:00）を過ぎているか。今夜の行だけ false。 */
  complete: boolean;
};

export type SleepSummary = {
  /** 集計に入れた夜の数（記録があり、かつ終わっている夜）。 */
  recordedCount: number;
  /** 集計の対象になりえた夜の数（終わっている夜）。分母として画面に出す。 */
  completedCount: number;
  /** 1晩あたりの平均（分）。記録が1晩も無ければ null。 */
  averageMinutes: number | null;
  /** 平均と目標の差（分）。負なら足りていない。 */
  diffMinutes: number | null;
  /** 目標に届かなかった夜の数。 */
  belowTargetCount: number;
  /** 就寝・起床の中央値（その行の12:00から数えた分）。記録が無ければ null。 */
  medianBedOffset: number | null;
  medianWakeOffset: number | null;
};

/**
 * 夜ごとの行を組み立てる。
 *
 * 睡眠かどうかは項目名で決める。Google側の予定に「これは睡眠」と書ける欄が無く、
 * 活動記録の保存先カレンダーに入っている予定のうち名前が一致するものだけが手掛かりになる。
 *
 * 行への割り当ては、セグメントへ事前分割せず**行ごとに全ての記録をクランプする**。
 * 時間グリッドが日ごとに `eventRange()` で切り詰めているのと同じ流儀で、
 * 昼をまたぐ睡眠のように2行にかかるものも、それぞれの行で正しい長さになる。
 */
export function buildSleepNights(input: {
  /** 活動記録の保存先カレンダーの予定。項目名の絞り込みはここで行う。 */
  events: GoogleEvent[];
  /** 進行中の記録。まだGoogleには存在しないため別に受け取る。 */
  running: { title: string; startedAt: string } | null;
  /** 睡眠として数える項目名。 */
  title: string;
  /** 並べる夜の日付キー（古い順）。 */
  nightKeys: string[];
  timeZone: string;
  /** 「いま」。行が終わっているかの判定と、進行中の記録の終わりに使う。 */
  now: Date;
}): SleepNight[] {
  const { events, running, title, nightKeys, timeZone, now } = input;

  const utils = createCalendarDateUtils(timeZone);
  const wanted = title.trim();

  // 行の境界と比べられる形（先頭の夜の12:00から数えた分）へ先に直しておく。
  // 行ごとに同じ変換を繰り返すと、30日 × 記録の件数ぶん Intl の変換が走る。
  const base = nightKeys[0];
  if (!base) return [];

  type Span = { from: number; to: number; running: boolean };
  const spans: Span[] = [];

  const offsetOf = (iso: string): number =>
    dateKeyDiffDays(base, utils.itemDateKey(iso)) * MINUTES_PER_NIGHT +
    utils.minutesFromMidnight(iso) -
    NIGHT_START_MINUTES;

  for (const event of events) {
    // 終日の予定は時間帯を持たない。記録は必ず時刻付きで作られる（running.ts）ため、
    // 終日で入っているものは手で足した別の予定として数えない（totals.ts と同じ扱い）。
    if (!event.start?.dateTime || !event.end?.dateTime) continue;
    if ((event.summary ?? "").trim() !== wanted) continue;

    spans.push({
      from: offsetOf(event.start.dateTime),
      to: offsetOf(event.end.dateTime),
      running: false,
    });
  }

  const nowOffset = offsetOf(now.toISOString());

  if (running && running.title.trim() === wanted) {
    spans.push({ from: offsetOf(running.startedAt), to: nowOffset, running: true });
  }

  return nightKeys.map((dateKey) => {
    // 並びの添字ではなく日付キーの差から求める。連続していない日を渡されても
    // 行の位置がずれない。
    const rowFrom = dateKeyDiffDays(base, dateKey) * MINUTES_PER_NIGHT;
    const rowTo = rowFrom + MINUTES_PER_NIGHT;

    const segments: SleepSegment[] = [];
    let minutes = 0;

    for (const span of spans) {
      const from = Math.max(span.from, rowFrom);
      const to = Math.min(span.to, rowTo);
      if (to <= from) continue;

      segments.push({ from: from - rowFrom, to: to - rowFrom, running: span.running });
      minutes += to - from;
    }

    segments.sort((a, b) => a.from - b.from);

    return {
      dateKey,
      segments,
      minutes,
      // 行の終わり（翌12:00）を過ぎているか。過ぎていない行はまだ結果が出ていない。
      complete: nowOffset >= rowTo,
    };
  });
}

/**
 * 行をまとめて、足りているかどうかを読める形にする。
 *
 * **平均は記録のある夜だけで割る。** 記録の無い夜を0分として数えると、まだこの記録の付け方を
 * していない夜のぶんだけ平均が下がり、実際に眠った時間とは違う数字になる。代わりに分母
 * （記録のある夜 / 終わった夜）を画面に出し、どれだけの夜から出した平均なのかを示す。
 *
 * 終わっていない行（今夜）は入れない。まだ眠っていない夜を0分として数えることになるため。
 */
export function summarizeSleepNights(
  nights: SleepNight[],
  targetMinutes: number,
): SleepSummary {
  const completed = nights.filter((night) => night.complete);
  const recorded = completed.filter((night) => night.minutes > 0);

  const total = recorded.reduce((sum, night) => sum + night.minutes, 0);
  const averageMinutes = recorded.length > 0 ? Math.round(total / recorded.length) : null;

  // 就寝・起床は、その夜のいちばん早い帯の始まりといちばん遅い帯の終わりで見る。
  // 中途で目が覚めて記録が分かれても、床に就いた時刻と起きた時刻はその両端になる。
  const beds = recorded.map((night) => night.segments[0].from);
  const wakes = recorded.map((night) => night.segments[night.segments.length - 1].to);

  return {
    recordedCount: recorded.length,
    completedCount: completed.length,
    averageMinutes,
    diffMinutes: averageMinutes === null ? null : averageMinutes - targetMinutes,
    belowTargetCount: recorded.filter((night) => night.minutes < targetMinutes).length,
    medianBedOffset: median(beds),
    medianWakeOffset: median(wakes),
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** 行の12:00から数えた分を、時計の表記（HH:MM）へ直す。 */
export function offsetToClock(offset: number): string {
  const minutes = (((offset + NIGHT_START_MINUTES) % MINUTES_PER_NIGHT) + MINUTES_PER_NIGHT) %
    MINUTES_PER_NIGHT;

  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** 睡眠時間の表記（7時間20分）。0分のときは「0分」。 */
export function formatSleepMinutes(minutes: number): string {
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? "−" : "";

  if (hours === 0) return `${sign}${rest}分`;
  if (rest === 0) return `${sign}${hours}時間`;
  return `${sign}${hours}時間${rest}分`;
}

/** 行の右端に出す短い表記（7:20）。桁を揃えたいので時間と分を必ず出す。 */
export function formatSleepShort(minutes: number): string {
  const sign = minutes < 0 ? "−" : "";
  const abs = Math.abs(minutes);

  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/** 目標との差の表記（+0:20 / −1:05）。0のときは ±0:00。 */
export function formatSleepDiff(minutes: number): string {
  if (minutes === 0) return "±0:00";
  return `${minutes > 0 ? "+" : ""}${formatSleepShort(minutes)}`;
}
