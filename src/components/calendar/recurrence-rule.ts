// 予定の繰り返し規則（RFC 5545 の RRULE）。Google Calendar の events.recurrence へそのまま渡す。
//
// 入力途中は数字の欄が空欄になるため、回数・間隔は文字列のまま持ち、
// 組み立てと検証のときに数値へ直す。

import { localInputToIso } from "./datetime-fields";

export type RecurrenceFrequency = "none" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

/** 繰り返しの終わり方。ずっと / 日付まで / 回数まで の3通り。 */
export type RecurrenceEnd = "never" | "until" | "count";

export type RecurrenceInput = {
  frequency: RecurrenceFrequency;
  /** 毎週のときに繰り返す曜日（0=日曜）。毎週以外では使わない。 */
  weekdays: number[];
  /** 何日・何週間・何か月・何年ごとに繰り返すか。 */
  interval: string;
  end: RecurrenceEnd;
  /** end が "until" のときの最終日（YYYY-MM-DD）。この日の分まで繰り返す。 */
  until: string;
  /** end が "count" のときの回数。1回目は開始日の分を数える。 */
  count: string;
};

export const NO_RECURRENCE: RecurrenceInput = {
  frequency: "none",
  weekdays: [],
  interval: "1",
  end: "never",
  until: "",
  count: "10",
};

export const FREQUENCY_OPTIONS: { value: RecurrenceFrequency; label: string }[] = [
  { value: "none", label: "繰り返さない" },
  { value: "DAILY", label: "毎日" },
  { value: "WEEKLY", label: "毎週" },
  { value: "MONTHLY", label: "毎月" },
  { value: "YEARLY", label: "毎年" },
];

export const END_OPTIONS: { value: RecurrenceEnd; label: string }[] = [
  { value: "never", label: "終了日なし" },
  { value: "until", label: "日付まで" },
  { value: "count", label: "回数まで" },
];

/** 曜日の並びと表記。RRULE の BYDAY は日曜始まりの2文字。 */
export const WEEKDAYS: { value: number; label: string; code: string }[] = [
  { value: 0, label: "日", code: "SU" },
  { value: 1, label: "月", code: "MO" },
  { value: 2, label: "火", code: "TU" },
  { value: 3, label: "水", code: "WE" },
  { value: 4, label: "木", code: "TH" },
  { value: 5, label: "金", code: "FR" },
  { value: 6, label: "土", code: "SA" },
];

/** 週の開始曜日（設定画面の値）から、チップを並べる順を作る。 */
export function orderedWeekdays(weekStartsOn: number) {
  const start = ((weekStartsOn % 7) + 7) % 7;
  return WEEKDAYS.map((_, index) => WEEKDAYS[(start + index) % 7]);
}

/**
 * 頻度を変えたあとの値。毎週にしたときは開始日の曜日を選んでおく。
 * 複数選択の欄が空のまま現れると、何も繰り返さないように見えるため。
 */
export function withFrequency(
  input: RecurrenceInput,
  frequency: RecurrenceFrequency,
  start: string,
): RecurrenceInput {
  if (frequency !== "WEEKLY") return { ...input, frequency };

  const weekday = weekdayOf(start);
  const weekdays =
    input.weekdays.length > 0 || weekday === null ? input.weekdays : [weekday];

  return { ...input, frequency, weekdays };
}

/**
 * 開始日を変えたあとの値。曜日を自分で選び直していない間だけ、新しい開始日の曜日へ移す。
 * 選び直したあとに動かすと、指定した曜日が黙って書き換わってしまうため。
 */
export function withStart(
  input: RecurrenceInput,
  previousStart: string,
  nextStart: string,
): RecurrenceInput {
  if (input.frequency !== "WEEKLY") return input;

  const previous = weekdayOf(previousStart);
  const next = weekdayOf(nextStart);
  if (previous === null || next === null || next === previous) return input;
  if (input.weekdays.length !== 1 || input.weekdays[0] !== previous) return input;

  return { ...input, weekdays: [next] };
}

/** 曜日の選択を入れ替える。 */
export function toggleWeekday(input: RecurrenceInput, weekday: number): RecurrenceInput {
  const weekdays = input.weekdays.includes(weekday)
    ? input.weekdays.filter((value) => value !== weekday)
    : [...input.weekdays, weekday].sort((a, b) => a - b);

  return { ...input, weekdays };
}

/** 入力欄の値（YYYY-MM-DD もしくは YYYY-MM-DDTHH:mm）の曜日。日付が無ければ null。 */
function weekdayOf(value: string): number | null {
  // 日付だけをUTC正午で扱い、タイムゾーンによる日付ずれを避ける。
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.getUTCDay();
}

/**
 * 間隔の入力欄に出すラベル。単位は頻度で変わるため、欄の外に単位を並べずラベルへ含める。
 * 入力欄が1つで済み、スマートフォンでも横に詰まらない。
 */
export function intervalLabel(frequency: RecurrenceFrequency): string {
  switch (frequency) {
    case "WEEKLY":
      return "何週間ごと";
    case "MONTHLY":
      return "何か月ごと";
    case "YEARLY":
      return "何年ごと";
    default:
      return "何日ごと";
  }
}

/** 入力の誤りを日本語で返す。問題が無ければ null。 */
export function recurrenceError(input: RecurrenceInput, start: string): string | null {
  if (input.frequency === "none") return null;

  if (!isPositiveInteger(input.interval)) {
    return "繰り返しの間隔は1以上の数字で入力してください。";
  }

  if (input.frequency === "WEEKLY" && input.weekdays.length === 0) {
    return "繰り返す曜日を1つ以上選んでください。";
  }

  if (input.end === "until") {
    if (!input.until) return "繰り返しの終了日を入力してください。";
    // start は終日なら YYYY-MM-DD、時刻ありなら YYYY-MM-DDTHH:mm。日付部分だけを比べる。
    if (start && input.until < start.slice(0, 10)) {
      return "繰り返しの終了日が開始日より前になっています。";
    }
  }

  if (input.end === "count" && !isPositiveInteger(input.count)) {
    return "繰り返す回数は1以上の数字で入力してください。";
  }

  return null;
}

/**
 * RRULE の文字列を組み立てる。繰り返さない場合は null。
 * 検証は recurrenceError が済ませている前提で、ここでは値をそのまま使う。
 */
export function buildRecurrenceRule(
  input: RecurrenceInput,
  { allDay, timeZone }: { allDay: boolean; timeZone: string },
): string | null {
  if (input.frequency === "none") return null;

  const parts = [`FREQ=${input.frequency}`];

  // INTERVAL=1 は既定値。付けても同じだが、Google Calendar の画面に出る文言が
  // 「1週間ごと」と冗長になるため省く。
  const interval = Number(input.interval);
  if (interval > 1) parts.push(`INTERVAL=${interval}`);

  // 毎週は曜日を複数指定できる。BYDAY が無いと開始日の曜日だけになる。
  if (input.frequency === "WEEKLY" && input.weekdays.length > 0) {
    const codes = [...input.weekdays]
      .sort((a, b) => a - b)
      .map((weekday) => WEEKDAYS[weekday].code);
    parts.push(`BYDAY=${codes.join(",")}`);
  }

  if (input.end === "until") {
    parts.push(`UNTIL=${untilValue(input.until, allDay, timeZone)}`);
  } else if (input.end === "count") {
    parts.push(`COUNT=${Number(input.count)}`);
  }

  return `RRULE:${parts.join(";")}`;
}

/**
 * UNTIL の値。RFC 5545 では DTSTART が日付なら日付、日時なら UTC の日時でなければならない。
 * 選んだ日の分まで繰り返したいので、時刻ありの場合はその日の終わりを UTC へ直す。
 */
function untilValue(until: string, allDay: boolean, timeZone: string): string {
  if (allDay) return until.replace(/-/g, "");

  const iso = localInputToIso(`${until}T23:59`, timeZone);
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function isPositiveInteger(value: string): boolean {
  return /^\d+$/.test(value) && Number(value) >= 1;
}
