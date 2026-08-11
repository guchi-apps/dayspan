import type { CalendarEventItem, CalendarItem, ReminderItem, TaskItem } from "@/types/calendar";

// 日付・時刻の解釈は、ユーザー設定のタイムゾーン（既定 Asia/Tokyo）で固定する。
// 実行環境のローカル時刻に依存させると、サーバー（VPSはUTC）とブラウザ（JST）で
// 描画結果がずれ、ハイドレーションが一致しなくなるため。

export const MINUTES_PER_DAY = 24 * 60;

// 1時間あたりの高さ（px）。ピンチで変えられるため定数ではなく初期値として扱う（docs/spec.md §6）。
export const DEFAULT_HOUR_HEIGHT = 48;
// 縮めきった状態でも一日ぶんの並びが読み取れ、広げきった状態でも15分の予定が掴める幅に収める。
export const MIN_HOUR_HEIGHT = 24;
export const MAX_HOUR_HEIGHT = 192;

/** 予定ブロックの最小の高さ（px）。極端に短い予定でもタイトルが読めるようにする。 */
export const MIN_EVENT_HEIGHT = 16;

/** 予定ブロックの本文1行の高さ（px）。text-[11px] / leading-tight の組み合わせに合わせる。 */
const EVENT_LINE_HEIGHT = 14;

/** 予定ブロックの上下の余白（px）。py-0.5 の上下ぶん。 */
const EVENT_BLOCK_PADDING_Y = 4;

/**
 * 予定ブロックの高さに何行ぶんの文字が収まるかを返す。
 *
 * 収まる行数ぶんだけ、タイトルの下へ時刻・場所・説明を順に添える（issue #73）。
 * 高さはピンチの倍率と予定の長さで決まるため、描画のたびに求める。
 * タイトルだけは高さが足りなくても出すため、最低でも1を返す。
 */
export function eventTextLines(height: number): number {
  return Math.max(1, Math.floor((height - EVENT_BLOCK_PADDING_Y) / EVENT_LINE_HEIGHT));
}

/**
 * 重なり判定での予定の最小の長さ（分）。
 *
 * 画面上は最小の高さぶんの場所を取るため、その高さを既定の倍率で分に直した値を使う。
 * 実際の高さで判定すると、ピンチで倍率を変えるたびに短い予定の列の並びが変わってしまう。
 */
const MIN_EVENT_MINUTES = (MIN_EVENT_HEIGHT / DEFAULT_HOUR_HEIGHT) * 60;

/**
 * タスクがカレンダーに現れる日付の種類（docs/spec.md §5）。
 *
 * 期限は締切、予定日はその辺りで片付けるつもりだという見込み。1つのタスクが
 * 別々の日に2つ現れるため、日付そのものではなく「どちらの日付か」を持ち回る。
 */
export type TaskDateField = "due" | "planned";

/** カレンダー上の1枠。タスクは期限と予定日で別の枠になるため、どちらの日付かを併せて持つ。 */
export type PlacedItem = { item: CalendarItem; taskField?: TaskDateField };

/** タスクが持つ、その種類の日付。 */
export function taskDateOf(
  task: TaskItem,
  field: TaskDateField,
): { date: string | null; hasTime: boolean } {
  return field === "planned"
    ? { date: task.planned, hasTime: task.plannedHasTime }
    : { date: task.due, hasTime: task.hasTime };
}

export type TaskOccurrence = {
  task: TaskItem;
  field: TaskDateField;
  /** この枠が指す日付。時刻なしは YYYY-MM-DD、時刻ありは ISO 8601。 */
  date: string;
  hasTime: boolean;
  /**
   * 枠の識別子。1つのタスクが期限と予定日で2枠に現れるため、IDだけでは区別できない
   * （どちらを掴んでいるのか・どちらのキーなのかが決まらなくなる）。
   */
  key: string;
};

export function taskOccurrenceKey(taskId: string, field: TaskDateField): string {
  return `${taskId}:${field}`;
}

/**
 * タスクをカレンダーに置く枠。期限と予定日の両方があれば2枠になる。
 *
 * 同じ日時を指しているときは期限の1枠にまとめる。同じ場所へ2つ並べても情報が増えず、
 * 同じタイトルが2行に見えるだけのため。日が同じで時刻が違う場合は位置が別になるので分ける。
 */
export function taskOccurrences(task: TaskItem): TaskOccurrence[] {
  const occurrences: TaskOccurrence[] = [];

  for (const field of ["due", "planned"] as const) {
    const { date, hasTime } = taskDateOf(task, field);
    if (!date) continue;
    if (field === "planned" && date === task.due) continue;

    occurrences.push({ task, field, date, hasTime, key: taskOccurrenceKey(task.id, field) });
  }

  return occurrences;
}

type ZonedParts = { dateKey: string; hour: number; minute: number };

function zonedParts(date: Date, formatter: Intl.DateTimeFormat): ZonedParts {
  const parts = formatter.formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export type CalendarDateUtils = ReturnType<typeof createCalendarDateUtils>;

export function createCalendarDateUtils(timeZone: string) {
  // Intl.DateTimeFormat の生成は重い。月表示は1度の描画で数万回この変換を通るため、
  // 呼び出しのたびに作ると描画がそれだけで数秒かかる。生成は1回にとどめる。
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    // hourCycle を指定しないと 24:00 表記になる環境があるため明示する。
    hourCycle: "h23",
  });

  // 同じ日時文字列は何度も変換される（1つの予定が、表示中の日数ぶん判定される）。
  // タイムゾーンが同じなら結果は必ず同じなので覚えておく。
  // このキャッシュはユーザー設定のタイムゾーンごとに閉じている（utilsごとに1つ）。
  const partsCache = new Map<string, ZonedParts>();

  const partsOf = (value: string): ZonedParts => {
    const cached = partsCache.get(value);
    if (cached) return cached;

    const parts = zonedParts(new Date(value), formatter);
    partsCache.set(value, parts);
    return parts;
  };

  /** ISO 8601（時刻あり）またはYYYY-MM-DD（日付のみ）を、設定タイムゾーンの日付キーに変換する。 */
  const itemDateKey = (value: string): string => {
    if (!value.includes("T")) return value;
    return partsOf(value).dateKey;
  };

  const minutesFromMidnight = (iso: string): number => {
    const { hour, minute } = partsOf(iso);
    return hour * 60 + minute;
  };

  const formatTime = (iso: string): string => {
    const { hour, minute } = partsOf(iso);
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  };

  // 「今日」は現在時刻に依存する。覚えてしまうと日付が変わっても古いままになるため通さない。
  const todayKey = (): string => zonedParts(new Date(), formatter).dateKey;

  /**
   * その日の中で予定が占める時間帯。日をまたぐ予定は、その日の範囲へ切り詰める。
   *
   * 画面上の位置ではなく分で返す。時間グリッドの高さはピンチで変わるため、
   * 位置を持ち回ると倍率を変えるたびに全ての計算をやり直すことになる。
   */
  const eventRange = (
    event: CalendarEventItem,
    dateKey: string,
  ): { startMinutes: number; endMinutes: number } => {
    const startsToday = itemDateKey(event.start) === dateKey;
    const endsToday = itemDateKey(event.end) === dateKey;

    return {
      startMinutes: startsToday ? minutesFromMidnight(event.start) : 0,
      endMinutes: endsToday ? minutesFromMidnight(event.end) : MINUTES_PER_DAY,
    };
  };

  /** 終日予定・複数日予定が、その日にかかっているか。 */
  const eventCoversDay = (event: CalendarEventItem, dateKey: string): boolean => {
    if (event.allDay) return event.start <= dateKey && dateKey <= event.end;
    return itemDateKey(event.start) <= dateKey && dateKey <= itemDateKey(event.end);
  };

  /** その日に置くタスクの枠。期限と予定日が別の日にあれば、日ごとに片方だけが返る。 */
  const taskOccurrencesOnDay = (tasks: TaskItem[], dateKey: string): TaskOccurrence[] =>
    tasks.flatMap((task) =>
      taskOccurrences(task).filter((occurrence) => itemDateKey(occurrence.date) === dateKey),
    );

  const itemSortTime = ({ item, taskField }: PlacedItem): number => {
    if (isAllDayItem(item, taskField)) return -1;
    if (item.kind === "event") return minutesFromMidnight(item.start);
    if (item.kind === "task") {
      const { date } = taskDateOf(item, taskField ?? "due");
      return date ? minutesFromMidnight(date) : -1;
    }
    return minutesFromMidnight(item.date);
  };

  /** 日ごとの表示順。終日→時刻順→同時刻はタイトル順に並べる。 */
  const compareItems = (a: PlacedItem, b: PlacedItem): number => {
    const diff = itemSortTime(a) - itemSortTime(b);
    if (diff !== 0) return diff;
    return a.item.title.localeCompare(b.item.title, "ja");
  };

  /**
   * 時間が重なる予定を横に並べる。重なりの集まりごとに列数を決め、
   * 同じ集まりの中で空いている列へ順に割り当てる。
   */
  const layoutOverlaps = (
    events: CalendarEventItem[],
    dateKey: string,
  ): { event: CalendarEventItem; column: number; columns: number }[] => {
    const sorted = [...events].sort(
      (a, b) => eventRange(a, dateKey).startMinutes - eventRange(b, dateKey).startMinutes,
    );

    /** 画面上で場所を取り終える時刻。最小の高さぶんは、短い予定でも占有しているものとして扱う。 */
    const occupiedUntil = (event: CalendarEventItem): number => {
      const { startMinutes, endMinutes } = eventRange(event, dateKey);
      return Math.max(endMinutes, startMinutes + MIN_EVENT_MINUTES);
    };

    const result: { event: CalendarEventItem; column: number; columns: number }[] = [];
    let cluster: { event: CalendarEventItem; column: number }[] = [];
    let clusterEnd = -1;

    const flush = () => {
      if (cluster.length === 0) return;
      const columns = Math.max(...cluster.map((entry) => entry.column)) + 1;
      result.push(...cluster.map((entry) => ({ ...entry, columns })));
      cluster = [];
      clusterEnd = -1;
    };

    for (const event of sorted) {
      const { startMinutes } = eventRange(event, dateKey);

      // 直前までの集まりと時間が重ならなくなったら、そこで列数を確定させる。
      if (startMinutes >= clusterEnd) flush();

      const usedColumns = new Set(
        cluster
          .filter((entry) => occupiedUntil(entry.event) > startMinutes)
          .map((entry) => entry.column),
      );

      let column = 0;
      while (usedColumns.has(column)) column += 1;

      cluster.push({ event, column });
      clusterEnd = Math.max(clusterEnd, occupiedUntil(event));
    }

    flush();

    return result;
  };

  return {
    itemDateKey,
    minutesFromMidnight,
    formatTime,
    todayKey,
    eventRange,
    eventCoversDay,
    taskOccurrencesOnDay,
    compareItems,
    layoutOverlaps,
  };
}

/**
 * 時刻のないタスクは時間グリッド上の位置が決まらないため、終日エリアへ入れる（docs/spec.md §6）。
 * タスクは期限と予定日で時刻の有無が別々のため、どちらの枠かによって答えが変わる。
 */
export function isAllDayItem(item: CalendarItem, taskField: TaskDateField = "due"): boolean {
  if (item.kind === "event") return item.allDay;
  if (item.kind === "reminder") return !item.hasTime;
  return !taskDateOf(item, taskField).hasTime;
}

/**
 * 毎年の日付リマインドが登録から何年目かを表すラベル（「(3年目)」）。
 * 登録した年（sourceDate）を1年目として数える。毎年の項目でない場合は null（docs/spec.md §9）。
 */
export function reminderAnnualYearLabel(reminder: ReminderItem): string | null {
  if (!reminder.annual) return null;
  const sourceYear = Number(reminder.sourceDate.slice(0, 4));
  const displayYear = Number(reminder.date.slice(0, 4));
  return `(${displayYear - sourceYear + 1}年目)`;
}
