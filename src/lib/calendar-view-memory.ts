// カレンダーを開き直したときに、前回見ていた表示形式・日付へ戻すための記憶（issue #279）。
//
// localStorage ではなくCookieに置く。/calendar はサーバーコンポーネントで、表示形式と日付から
// Google・Notionへの取得範囲を組み立ててから描いている（src/app/calendar/page.tsx）。
// localStorage だと描き終えてからクライアントで読むことになり、今日の月を取ったあとに
// 前回の期間をもう一度取り直す（外部APIへの往復が倍になる）。Cookieなら最初の描画前に読める。
//
// 覚えているのは表示形式と日付だけで、予定・タスクの中身は入れない。

import { CALENDAR_VIEWS, type CalendarView } from "./calendar-range";

export const CALENDAR_VIEW_COOKIE = "dayspan_calendar_view";

/**
 * 記憶の有効期間。
 *
 * 「基本は今日を月表示」を既定に保つため、少し前に見ていた続きだけを復元する。
 * 期限はCookieの max-age で表し、サーバー側に時刻の判定を持たない
 * （持つと保存時刻の解釈がタイムゾーンに依存する）。
 */
export const CALENDAR_VIEW_MAX_AGE_SECONDS = 60 * 60;

/** Cookieに入れる値。`day3:2026-08-21` の形。 */
export function formatCalendarMemory(view: CalendarView, dateKey: string): string {
  return `${view}:${dateKey}`;
}

/** Cookieの値を読む。形式が違えば覚えていなかったものとして扱う。 */
export function parseCalendarMemory(
  value: string | undefined,
): { view: CalendarView; dateKey: string } | null {
  if (!value) return null;

  const [view, dateKey] = value.split(":");
  if (!CALENDAR_VIEWS.includes(view as CalendarView)) return null;
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;

  return { view: view as CalendarView, dateKey };
}

/**
 * いま見ている状態を覚える（クライアント専用）。
 *
 * 呼ぶのはURLを書き換えるのと同じ場所にそろえる。「URLに出ている状態＝次に開いたときの状態」で
 * 一つの規則になり、覚える条件を別に考えずに済む。
 */
export function rememberCalendarView(view: CalendarView, dateKey: string): void {
  if (typeof document === "undefined") return;

  // 他サイトからの遷移では送られなくてよいため lax。https のときだけ secure を付ける
  // （開発サーバーは http で、付けるとブラウザがCookieごと捨てる）。
  const secure = window.location.protocol === "https:" ? "; secure" : "";

  document.cookie =
    `${CALENDAR_VIEW_COOKIE}=${formatCalendarMemory(view, dateKey)}` +
    `; path=/; max-age=${CALENDAR_VIEW_MAX_AGE_SECONDS}; samesite=lax${secure}`;
}
