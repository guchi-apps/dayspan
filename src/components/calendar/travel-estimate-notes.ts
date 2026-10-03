import type { TravelEstimateSource } from "@/types/calendar";

/**
 * 所要時間の区画に出す文言（docs/spec.md §29）。
 *
 * JSXから分けているのは、出どころの組み合わせで言い分ける規則がここにしか無いため。
 * 部品の中に混ぜると、規則だけを読むにも動かすにもコンポーネントを通ることになる。
 */

/**
 * 表示画面で所要時間に添える出どころ（docs/spec.md §29）。
 *
 * 手入力のときは何も添えない（`TravelItem.estimated` が false になり、呼び出し元が出さない）。
 */
export function estimateSourceLabel(source: TravelEstimateSource): string {
  if (source === "YAHOO") return "（Yahoo!乗換案内）";
  if (source === "GOOGLE_MAPS") return "（Googleマップの経路）";
  if (source === "TRANSIT") return "（経路検索の平均）";
  return "（AIによる目安）";
}
