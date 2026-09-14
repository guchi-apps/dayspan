import type { ReactNode } from "react";

import { AppSidebar } from "@/components/nav/app-sidebar";
import type { NavKey } from "@/components/nav/nav-items";
import type { RunningActivitySummary } from "@/types/activity";

/**
 * 下部ナビから開く5画面（カレンダー・タスク・記録・勤務・買い物）の外枠（issue #636）。
 *
 * 1024px以上では左端にサイドバーを置き、残りの幅を本文に渡す。本文の列は
 * `@container/main` にしてあり、各画面の段組みは画面幅ではなく**この列の幅**で切り替える。
 * サイドバーの有無で本文の幅が224px変わるため、ビューポートで切ると 1024〜1279px で
 * 列が詰まりすぎる。
 */
export function AppFrame({
  current,
  activityRunning,
  running = null,
  children,
}: {
  current: NavKey;
  activityRunning: boolean;
  /** サイドバーの下端に出す記録中の1件。 */
  running?: RunningActivitySummary | null;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh">
      <AppSidebar current={current} activityRunning={activityRunning} running={running} />
      <div className="@container/main flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
