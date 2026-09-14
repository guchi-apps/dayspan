"use client";

import Link from "next/link";
import { Square } from "lucide-react";

import { formatElapsed } from "@/components/calendar/activity-format";
import { DrawerNavContent, RunningDot } from "@/components/nav/app-drawer";
import type { NavKey } from "@/components/nav/nav-items";
import { useRunningActivityStop } from "@/components/nav/use-running-activity-stop";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import type { RunningActivitySummary } from "@/types/activity";

/**
 * 1024px以上で左端に常に出すナビ（issue #636）。
 *
 * 中身はドロワーと同じもの（`DrawerNavContent`）をそのまま描く。狭い画面ではメニューボタンから
 * 開き、広い画面では開いたまま置いておく、という違いだけにして、探す位置（左端）も並びも
 * 画面幅で入れ替えない（docs/spec.md §4）。
 *
 * 勤務の未対応の件数は出さない。ドロワーは開いたときだけ取りにいくが、常に出すこの面で数えると
 * 画面を開くたびにNotionへの往復が1本増える（下部ナビの「勤務」にバッジが無いのと同じ扱い）。
 */
export function AppSidebar({
  current,
  activityRunning,
  running,
}: {
  current: NavKey;
  activityRunning: boolean;
  /** 下端に出す記録中の1件。記録画面ではカードが本文にあるため null を渡す。 */
  running: RunningActivitySummary | null;
}) {
  return (
    <aside
      aria-label="画面の切り替え"
      className="hidden w-56 shrink-0 flex-col border-r border-outline-variant bg-surface-container-low pt-4 pb-3 lg:flex"
    >
      <div className="px-6 pb-2 text-base font-semibold">DaySpan</div>
      <DrawerNavContent
        current={current}
        activityRunning={activityRunning}
        footer={running && <SidebarRunningCard running={running} />}
      />
    </aside>
  );
}

/**
 * サイドバーの下端の記録中カード。狭い画面で下部ナビの直上に出す帯（running-activity-bar.tsx）と
 * 同じ役割で、止めるまでの最短経路。詳しい操作は記録画面に閉じる。
 */
function SidebarRunningCard({ running }: { running: RunningActivitySummary }) {
  const { running: current, nowIso, busy, error, offline, stop } = useRunningActivityStop(running);

  if (!current) return null;

  return (
    <div className="mx-3 flex flex-col gap-2 rounded-2xl bg-primary-container p-3 text-on-primary-container elevation-1">
      <Link href="/activity" className="flex min-w-0 flex-col gap-0.5 leading-tight">
        <span className="flex min-w-0 items-center gap-2">
          <RunningDot />
          <span className="type-body-medium clip-nowrap">{error ?? current.title}</span>
        </span>
        {nowIso && !error && (
          <span className="type-headline-small tabular-nums">
            {formatElapsed(current.startedAt, nowIso)}
          </span>
        )}
      </Link>

      <Button
        size="sm"
        className="self-start"
        disabled={busy || offline}
        title={offline ? OFFLINE_WRITE_MESSAGE : undefined}
        onClick={stop}
      >
        <Square className="fill-current" />
        停止
      </Button>
    </div>
  );
}
