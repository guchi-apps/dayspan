import type { ShoppingItem } from "@/types/shopping";

/**
 * 買い物リストのうち、購入予定日が今日以前の未購入の数（docs/spec.md §32）。
 *
 * タスクの「期限が今日以前」と同じ基準にそろえる。購入予定日を持たないものは
 * 「いつまでに」が決まっていないため数えない。`todayKey` は設定タイムゾーンの今日（`YYYY-MM-DD`）。
 */
export function countDueShopping(items: ShoppingItem[], todayKey: string): number {
  return items.filter((item) => !item.bought && item.plannedDate !== null && item.plannedDate <= todayKey)
    .length;
}

export type BadgeCounts = {
  tasks: number | null;
  shopping: number | null;
  /** アプリアイコンのバッジ。どちらかが取れていないときは null（バッジを触らない）。 */
  total: number | null;
};

/** 取れなかった側があるときに合計だけを出すと、実際より少ない件数が印に出る。 */
export function combineBadgeCounts(tasks: number | null, shopping: number | null): BadgeCounts {
  return {
    tasks,
    shopping,
    total: tasks !== null && shopping !== null ? tasks + shopping : null,
  };
}
