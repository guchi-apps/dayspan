import { Briefcase, CalendarDays, ListChecks, ShoppingCart, Timer } from "lucide-react";

/**
 * メインナビの5項目（docs/spec.md §4）。
 *
 * 並びは左から カレンダー・タスク・記録・勤務・買い物リスト（issue #328・#434・#508）。
 * 狭い画面の下部ナビ（main-nav.tsx）と、どの幅でも開くドロワー（app-drawer.tsx）の
 * 両方がここを見る。並びが2か所に分かれていると、同じアプリの中で探す位置が
 * 画面幅によって入れ替わるため。
 *
 * ドロワーから下部ナビを import しないのは、下部ナビが長押しのシート
 * （ActivityQuickSheet）まで抱えており、メニューを開くだけの経路がそれを連れてくるため。
 */
export const NAV_ITEMS = [
  { href: "/calendar", key: "calendar", label: "カレンダー", icon: CalendarDays },
  { href: "/tasks", key: "tasks", label: "タスク", icon: ListChecks },
  { href: "/activity", key: "activity", label: "記録", icon: Timer },
  { href: "/work", key: "work", label: "勤務", icon: Briefcase },
  { href: "/shopping", key: "shopping", label: "買い物", icon: ShoppingCart },
] as const;

export type NavKey = (typeof NAV_ITEMS)[number]["key"];
