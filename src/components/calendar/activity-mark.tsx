"use client";

import { ACTIVITY_ICONS, resolveActivityIcon } from "@/lib/activity-icons";
import { cn } from "@/lib/utils";

import { useActivityIcons } from "./activity-icon-context";

/**
 * カレンダー上で活動記録（記録から作られた予定）を示す印（issue #241）。
 *
 * 塗りを落とした枠だけでは、色の薄い予定と見分けが付かない。何の枠なのかは形で示す。
 *
 * タスクの縦棒（期限という「点」）、日付リマインドの菱形と並べても取り違えないよう、
 * 塗らない円にする。過ぎた時間を表す印なので、時計の文字盤に近い形を選んでいる。
 *
 * 項目にアイコンがあるときは、その線画に置き換える（issue #907）。何の記録かをひと目で示すため。
 * 選べる図柄は移動・買い物・出張の印と重ならないものに限っている（`activity-icons.ts`）。
 * 幅が足りない場面（レーンで記録どうしが重なったとき）は `title` を渡さず円のまま使う。
 */
export function ActivityMark({
  className,
  title,
  iconClassName = "size-2.5",
}: {
  /** 円のときの大きさ。 */
  className?: string;
  /** 項目名。渡したときだけアイコンを引く。 */
  title?: string;
  /** アイコンのときの大きさ。 */
  iconClassName?: string;
}) {
  const icons = useActivityIcons();
  const key = title === undefined ? null : resolveActivityIcon(title, icons[title]);

  if (key) {
    const Icon = ACTIVITY_ICONS[key];
    // 10px では既定の線幅だと細り、輪郭が地に溶ける（TravelMark と同じ扱い）。
    return (
      <Icon
        aria-hidden
        strokeWidth={2.2}
        className={cn("shrink-0 opacity-85", iconClassName)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn("shrink-0 rounded-full border-[1.5px] border-current opacity-85", className)}
    />
  );
}
