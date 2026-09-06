import { Car, Footprints, type LucideIcon, Route, TrainFront } from "lucide-react";

import { cn } from "@/lib/utils";
import type { TravelMode } from "@/types/calendar";

/**
 * カレンダー上で移動を示す印（docs/spec.md §29）。
 *
 * 交通手段（`TravelMode`）ごとの線画にする。以前は「どこからどこへ」を向きで表した右矢印1つで
 * 示していたが、矢印は方向・遷移・「次へ」など何にでも当たる記号で、移動そのものを指していない
 * （予定の表示画面では、行を開く `ChevronRight` と右向きの記号が2つ並んでもいた。issue #548）。
 * 車・電車・足跡は輪郭を読んだ時点で移動だと分かる。
 *
 * 日付リマインドの菱形・タスクの縦棒と違って輪郭に幅が要るが、その幅（8px→10px）を割く判断は
 * ゴミの日をゴミ箱の線画にしたとき（issue #303）と同じ。移動のチップに出るのは行き先の名前だけで、
 * 「大阪駅」を読んでもそれが移動なのか予定なのかは分からない。
 *
 * 印が交通手段まで示すのは、月表示のチップには行き先と出発時刻しか出ておらず、車で行くのか
 * 電車で行くのかが押して開くまで読めないため。時間グリッドの帯では2行目の「車 25分」と重なるが、
 * 短い移動ではその行が落ちる（`eventTextLines`）。
 *
 * 公共交通は電車の形で代表させる。この分類にはバス・飛行機も入る（issue #538）が、図柄を増やすと
 * 交通手段の分類そのものを分け直すことになる。
 */
const MODE_ICONS: Record<TravelMode, LucideIcon> = {
  CAR: Car,
  PUBLIC_TRANSIT: TrainFront,
  WALK: Footprints,
  OTHER: Route,
};

export function TravelMark({ mode, className }: { mode: TravelMode; className?: string }) {
  const Icon = MODE_ICONS[mode];

  // 既定の 2 では 10px にしたときに線が 0.83px まで細り、輪郭が地に溶ける（ゴミ箱と同じ扱い）。
  return <Icon aria-hidden strokeWidth={2.2} className={cn("shrink-0", className)} />;
}
