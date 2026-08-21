import type { CalendarEventItem, TaskEventStage } from "@/types/calendar";

/**
 * 段階から予定日を決める（docs/spec.md §31）。
 *
 * 「開始まで」「実施中」は予定の開始、「終了まで」「終了後」は予定の終了に置く。
 * 開始側・終了側で日時をずらさないのは、段階が「いつ」ではなく「予定のどの位置か」を
 * 表しているため。何分前に置くかは予定の中身によって違い、決め打ちできない。
 *
 * 終日予定は日付のみ（YYYY-MM-DD）で解決する。CalendarEventItem.end は終了日を含む形
 * （Googleの排他的な end.date から1日戻したもの）なので、そのまま最終日として使える。
 */
export function resolveStageDate(
  event: Pick<CalendarEventItem, "allDay" | "start" | "end">,
  stage: TaskEventStage,
): { date: string; allDay: boolean } {
  const atEnd = stage === "BEFORE_END" || stage === "AFTER_END";
  return { date: atEnd ? event.end : event.start, allDay: event.allDay };
}

/**
 * 予定日が紐づけ先の予定とずれているか。
 *
 * 日付のみと時刻ありは文字列の形が違う（YYYY-MM-DD と ISO 8601）ため、まず形を揃えて比べる。
 * Notionは時刻ありの日付をタイムゾーン付きで返し、同じ時刻でも表記が変わりうるので、
 * 時刻ありは文字列ではなくミリ秒で比べる。
 */
export function isSameTaskDate(
  a: { date: string | null; allDay: boolean },
  b: { date: string | null; allDay: boolean },
): boolean {
  if (!a.date || !b.date) return a.date === b.date;
  if (a.allDay !== b.allDay) return false;
  if (a.allDay) return a.date === b.date;

  const left = new Date(a.date).getTime();
  const right = new Date(b.date).getTime();
  if (Number.isNaN(left) || Number.isNaN(right)) return a.date === b.date;

  return left === right;
}
