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

/**
 * 月表示を上下に連続スクロールさせるための週の並び。
 * 月ごとに切り替えるのではなく、前後の月まで地続きに並べて途切れなく読めるようにする。
 */
export function getContinuousMonthWeeks(
  anchor: Date,
  weekStartsOn: number,
  monthsAround = 2,
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
