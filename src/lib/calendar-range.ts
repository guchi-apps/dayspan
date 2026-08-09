// 表示期間の計算。タイムゾーンの解釈は表示側（ブラウザのローカル時刻）に寄せ、
// ここでは「どの日付を並べるか」だけを決める。

export type CalendarView = "month" | "day1" | "day3" | "day7";

export const CALENDAR_VIEWS: CalendarView[] = ["month", "day1", "day3", "day7"];

export function parseView(value: string | undefined): CalendarView {
  return CALENDAR_VIEWS.includes(value as CalendarView) ? (value as CalendarView) : "month";
}

/** YYYY-MM-DD を素の日付として扱う。タイムゾーンの影響を受けないようUTC正午で保持する。 */
export function parseDateKey(value: string | undefined): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00Z`);
  }
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12));
}

export function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

/** 表示するカレンダーの日付を並べる。月表示は週の区切りに合わせて6週分を返す。 */
export function getVisibleDays(
  view: CalendarView,
  anchor: Date,
  weekStartsOn: number,
): { days: string[]; weeks: string[][] } {
  if (view !== "month") {
    const length = view === "day1" ? 1 : view === "day3" ? 3 : 7;
    const days = Array.from({ length }, (_, i) => toDateKey(addDays(anchor, i)));
    return { days, weeks: [days] };
  }

  const firstOfMonth = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 12),
  );
  const offset = (firstOfMonth.getUTCDay() - weekStartsOn + 7) % 7;
  const gridStart = addDays(firstOfMonth, -offset);

  // 月によって5週で収まる場合と6週必要な場合があるが、週数が変わると行の高さが揺れるため
  // 常に6週で固定する。
  const weeks: string[][] = [];
  for (let week = 0; week < 6; week += 1) {
    weeks.push(Array.from({ length: 7 }, (_, i) => toDateKey(addDays(gridStart, week * 7 + i))));
  }

  return { days: weeks.flat(), weeks };
}

/**
 * 外部APIへ渡す取得期間。表示端の日をローカル時刻で解釈したときに欠けないよう、
 * 前後1日ずつ余裕を持たせる。
 */
export function getFetchRange(days: string[]): { timeMin: string; timeMax: string } {
  const first = new Date(`${days[0]}T00:00:00Z`);
  const last = new Date(`${days[days.length - 1]}T00:00:00Z`);

  return {
    timeMin: addDays(first, -1).toISOString(),
    timeMax: addDays(last, 2).toISOString(),
  };
}

export function shiftAnchor(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  if (view === "month") return addMonths(anchor, direction);
  const step = view === "day1" ? 1 : view === "day3" ? 3 : 7;
  return addDays(anchor, step * direction);
}

// --- 月表示で保持する範囲 ---
//
// 月表示は前後の月まで地続きに並べる。移動のたびに全部を取り直すと、押すたびに外部APIへの
// 往復が発生して待たされるため、この窓のぶんをクライアントで保持し、窓から外れた月だけを
// 取得・破棄する（docs/spec.md §20 の自動更新間隔で鮮度を保つ）。

/** 見ている月の前後、いくつの月を保持するか。 */
export const MONTHS_AROUND = 3;

/** YYYY-MM を、その月の1日（UTC正午）として扱う。 */
export function parseMonthKey(monthKey: string): Date {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return new Date(Date.UTC(year, month - 1, 1, 12));
}

export function toMonthKey(date: Date): string {
  return toDateKey(date).slice(0, 7);
}

/** YYYY-MM を月単位でずらす。 */
export function shiftMonthKey(monthKey: string, delta: number): string {
  return toMonthKey(addMonths(parseMonthKey(monthKey), delta));
}

/** 何ヶ月離れているか（符号つき）。 */
export function monthDistance(from: string, to: string): number {
  const years = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  return years * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
}

/**
 * 週の並びが触れる月すべて。古い順に並ぶ。
 *
 * 端の週は前後の月にかかる（月初の週は前月の日を含む）。中心から前後何ヶ月、と数えて
 * しまうとその端の日のデータが範囲から漏れ、画面に出ているのに空欄になる。
 */
export function monthsOfWeeks(weeks: string[][]): string[] {
  const months = new Set<string>();

  for (const week of weeks) {
    for (const dateKey of week) months.add(dateKey.slice(0, 7));
  }

  return [...months].sort();
}

/** 月の集合を、外部APIへ渡す取得期間に変換する。 */
export function getMonthsFetchRange(months: string[]): { timeMin: string; timeMax: string } {
  const sorted = [...months].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  // 月末は「翌月の0日」で求める。
  const lastDay = toDateKey(
    new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0, 12)),
  );

  return getFetchRange([`${first}-01`, lastDay]);
}

/**
 * 月表示を上下に連続スクロールさせるための週の並び。
 * 月ごとに切り替えるのではなく、前後の月まで地続きに並べて途切れなく読めるようにする。
 */
export function getContinuousMonthWeeks(
  anchor: Date,
  weekStartsOn: number,
  monthsAround = MONTHS_AROUND,
): { weeks: string[][]; days: string[] } {
  const firstMonth = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - monthsAround, 1, 12),
  );
  // 月末は「翌月の0日」で求める。
  const lastMonthEnd = new Date(
    Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + monthsAround + 1, 0, 12),
  );

  const offset = (firstMonth.getUTCDay() - weekStartsOn + 7) % 7;
  let cursor = addDays(firstMonth, -offset);

  const weeks: string[][] = [];
  while (cursor.getTime() <= lastMonthEnd.getTime()) {
    weeks.push(Array.from({ length: 7 }, (_, i) => toDateKey(addDays(cursor, i))));
    cursor = addDays(cursor, 7);
  }

  return { weeks, days: weeks.flat() };
}

/** その週がどの月に属するとみなすか。週の中日（4日目）の月を採る。 */
export function weekMonthKey(week: string[]): string {
  return week[3].slice(0, 7);
}
