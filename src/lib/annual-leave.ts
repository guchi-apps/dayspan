import { annualLeaveDays, type WorkRecordItem } from "@/types/work";

/**
 * 年休の取得状況を年度で数える（docs/spec.md §34）。
 *
 * 画面から切り離した純粋な関数として置く。日付は `YYYY-MM-DD` の文字列だけで扱い、実行環境の
 * ローカル時刻には依存させない（サーバーはUTC・ブラウザはJSTで動くため、`Date` のローカル
 * メソッドを使うと同じ年度が両者で違う期間になり、ハイドレーションが一致しない）。
 */

/** YYYY-MM-DD 同士を安全に足し引きするための、UTC固定の日付づくり。 */
function dateKeyOf(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10);
}

/** 開始日から終了日までの日数（両端を含む）。時刻を持たないためUTCで数えて構わない。 */
export function daysBetween(fromKey: string, toKey: string): number {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  return Math.floor((to - from) / 86_400_000) + 1;
}

/** 1日進めた YYYY-MM-DD。 */
function nextDateKey(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** 年度の開始月として受け付ける値か（1〜12）。壊れた値は既定の4月として扱う。 */
export const DEFAULT_FISCAL_YEAR_START_MONTH = 4;

export function normalizeStartMonth(month: number | null | undefined): number {
  if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12) {
    return DEFAULT_FISCAL_YEAR_START_MONTH;
  }
  return month;
}

/**
 * その日が属する年度（＝年度の開始年）。
 *
 * 開始月が4月なら 2026-03-31 は 2025年度、2026-04-01 は 2026年度。開始月が1月なら暦年と同じ。
 */
export function fiscalYearOf(dateKey: string, startMonth: number): number {
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7));
  return month >= normalizeStartMonth(startMonth) ? year : year - 1;
}

/** 年度の期間。終わりは翌年度の初日の1日前（月ごとの日数を持たずに求められる）。 */
export function fiscalYearRange(
  fiscalYear: number,
  startMonth: number,
): { from: string; to: string } {
  const month = normalizeStartMonth(startMonth);
  const from = dateKeyOf(fiscalYear, month, 1);
  // 翌年度の初日の前日。うるう年もここで自動的に吸収される。
  const nextStart = new Date(Date.UTC(fiscalYear + 1, month - 1, 1));
  nextStart.setUTCDate(nextStart.getUTCDate() - 1);
  return { from, to: nextStart.toISOString().slice(0, 10) };
}

/**
 * 年度の見出し。開始月が1月のときは暦年そのものなので「2026年」と出す
 * （「2026年度（2026/1/1 – 2026/12/31）」は、年度と暦年が同じであることが読み取りにくい）。
 */
export function fiscalYearLabel(fiscalYear: number, startMonth: number): string {
  return normalizeStartMonth(startMonth) === 1 ? `${fiscalYear}年` : `${fiscalYear}年度`;
}

/** 年度に含まれる月（`YYYY-MM`）を開始月から12個。月ごとの内訳の枠になる。 */
export function fiscalYearMonths(fiscalYear: number, startMonth: number): string[] {
  const month = normalizeStartMonth(startMonth);
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(fiscalYear, month - 1 + index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export type AnnualLeaveMonth = {
  /** YYYY-MM */
  monthKey: string;
  taken: number;
  planned: number;
};

export type AnnualLeaveSummary = {
  /** 今日までに取った日数（半休は0.5日）。 */
  taken: number;
  /** 明日以降に入れてある日数。 */
  planned: number;
  months: AnnualLeaveMonth[];
  /** 年度に重なる年休の記録。日付の新しい順（一覧はこの順で出す）。 */
  records: WorkRecordItem[];
};

/**
 * 年度ぶんの年休を数える。
 *
 * 数え方は勤務画面の月の集計（`Tally()`）と同じで、**日ごとに** `annualLeaveDays()` を足す。
 * 期間の全休（夏季休暇など）は1件でも日数ぶんになり、半休は0.5日になる。記録の期間が年度から
 * はみ出す場合は、年度の中に入っている日だけを数える（年度をまたぐ記録を丸ごと片方の年度へ
 * 入れると、両方の年度の合計が実際に休んだ日数と合わなくなる）。
 *
 * 今日より後の日を `planned` に分けるのは、まだ休んでいない日を「使った」として扱わないため。
 * 今日をまたぐ期間の記録は、前半を `taken`・後半を `planned` に振り分ける。
 */
export function summarizeAnnualLeave(
  records: WorkRecordItem[],
  range: { from: string; to: string },
  todayKey: string,
): AnnualLeaveSummary {
  const monthly = new Map<string, AnnualLeaveMonth>();
  let taken = 0;
  let planned = 0;

  for (const record of records) {
    if (!record.annualLeave) continue;
    const perDay = annualLeaveDays(record.annualLeave);
    // 年度の中に入っている日だけを数える。
    const start = record.startDate > range.from ? record.startDate : range.from;
    const end = record.endDate < range.to ? record.endDate : range.to;

    for (let dateKey = start; dateKey <= end; dateKey = nextDateKey(dateKey)) {
      const monthKey = dateKey.slice(0, 7);
      const month = monthly.get(monthKey) ?? { monthKey, taken: 0, planned: 0 };
      if (dateKey <= todayKey) {
        taken += perDay;
        month.taken += perDay;
      } else {
        planned += perDay;
        month.planned += perDay;
      }
      monthly.set(monthKey, month);
    }
  }

  const startMonth = Number(range.from.slice(5, 7));
  const fiscalYear = Number(range.from.slice(0, 4));
  const months = fiscalYearMonths(fiscalYear, startMonth).map(
    (monthKey) => monthly.get(monthKey) ?? { monthKey, taken: 0, planned: 0 },
  );

  return {
    taken,
    planned,
    months,
    records: [...records].sort((a, b) => b.startDate.localeCompare(a.startDate)),
  };
}

/**
 * 見込みを出すのに要る経過日数。
 *
 * 年度が始まったばかりだと、1件取っただけで「年度末に80日取得」のような数字になる。
 * 1か月ぶん経ってから出す。
 */
const PROJECTION_MIN_ELAPSED_DAYS = 30;

export type AnnualLeavePace = {
  /** 年度の日数（365 か 366）。 */
  totalRangeDays: number;
  /** 年度の初日から今日までの日数。年度が始まる前は0。 */
  elapsedDays: number;
  elapsedRatio: number;
  /** 経過ぶんに合わせるなら今日までに取っているはずの日数。 */
  expected: number;
  /** 取得済み − 想定。正なら早め、負ならゆっくり。 */
  diff: number;
  /** このペースのまま行った場合の年度末の取得日数。経過が短いうちは null。 */
  projectedTaken: number | null;
};

/**
 * 消化のペース。年度が始まっていない（経過0日）ときは null を返し、画面では区画ごと出さない。
 *
 * 「想定」は付与日数を年度の日数で割った直線のペース。年休の取りどきは実際には偏る（夏季・
 * 年末）ので、これは目標ではなく目安として出す。
 */
export function annualLeavePace({
  totalDays,
  taken,
  range,
  todayKey,
}: {
  /** 付与＋繰越の合計。 */
  totalDays: number;
  taken: number;
  range: { from: string; to: string };
  todayKey: string;
}): AnnualLeavePace | null {
  if (todayKey < range.from) return null;

  const totalRangeDays = daysBetween(range.from, range.to);
  const endKey = todayKey < range.to ? todayKey : range.to;
  const elapsedDays = daysBetween(range.from, endKey);
  const elapsedRatio = elapsedDays / totalRangeDays;
  const expected = totalDays * elapsedRatio;

  return {
    totalRangeDays,
    elapsedDays,
    elapsedRatio,
    expected,
    diff: taken - expected,
    projectedTaken:
      elapsedDays >= PROJECTION_MIN_ELAPSED_DAYS ? (taken / elapsedDays) * totalRangeDays : null,
  };
}

/** 一覧の1件が何日ぶんか。年度の外へはみ出したぶんは数えない（集計と同じ切り詰め方）。 */
export function recordDaysInRange(
  record: WorkRecordItem,
  range: { from: string; to: string },
): number {
  if (!record.annualLeave) return 0;
  const start = record.startDate > range.from ? record.startDate : range.from;
  const end = record.endDate < range.to ? record.endDate : range.to;
  if (start > end) return 0;
  return daysBetween(start, end) * annualLeaveDays(record.annualLeave);
}

/**
 * その記録が今日より後だけの予定か。一覧を「予定」と「取得済み」に分けるのに使う。
 *
 * 今日にかかっている期間の記録は「取得済み」に入れる（もう休み始めているため）。日数の内訳では
 * 今日以前と以後に分かれるが、一覧の行はひとつしか置けないので開始日で決める。
 */
export function isPlannedRecord(record: WorkRecordItem, todayKey: string): boolean {
  return record.startDate > todayKey;
}
