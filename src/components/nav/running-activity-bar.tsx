"use client";

import Link from "next/link";
import { Square } from "lucide-react";

import { formatElapsed } from "@/components/calendar/activity-format";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { useRunningActivityStop } from "@/components/nav/use-running-activity-stop";
import { Button } from "@/components/ui/button";
import type { RunningActivitySummary } from "@/types/activity";

/**
 * どの画面からでも記録中であることが分かる帯（issue #629）。
 *
 * 記録中かどうかは以前から下部ナビ・ドロワーの点で示していたが、何を記録しているか・
 * どれだけ経ったか・止める操作は `/activity` を開かないと分からなかった。止め忘れたまま
 * 別の画面で作業を続けてしまうのを防ぐため、下部ナビの直上に浮かせて常に出す。
 *
 * 出す画面はナビの点と同じ範囲（カレンダー・タスク・勤務・買い物リスト）に揃える。
 * `/activity` 自体はすでに詳細な記録カードを表示済みのため対象外。
 *
 * 1024px以上ではサイドバーの下端に同じものを置くため、この帯は出さない（issue #636）。
 * 中身の下端を帯が塞がず、どの画面でも同じ位置に経過時間と停止が残る。
 */
export function RunningActivityBar({ running }: { running: RunningActivitySummary | null }) {
  const { running: current, nowIso, busy, error, offline, stop } = useRunningActivityStop(running);

  if (!current) return null;

  return (
    <div className="mx-2 mb-2 flex shrink-0 items-center gap-2 rounded-2xl bg-primary-container px-2 py-2 pl-3.5 text-on-primary-container elevation-1 lg:hidden">
      {/* 詳しい操作（開始時刻の修正・取り消し）は記録画面に閉じる。ここは止めるまでの最短経路。 */}
      <Link href="/activity" className="flex min-w-0 flex-1 items-center gap-2.5">
        <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="type-body-medium clip-nowrap">{error ?? current.title}</span>
          {nowIso && !error && (
            <span className="type-title-small tabular-nums">
              {formatElapsed(current.startedAt, nowIso)}
            </span>
          )}
        </span>
      </Link>

      <Button
        size="sm"
        className="shrink-0"
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

/**
 * 下部ナビの直上に固定位置で置かれたFAB（追加ボタン）の `bottom` オフセット。
 *
 * カレンダー・タスク・買い物リストの各画面には、下部ナビの直上に固定位置のFABがある。
 * この帯が表示されると同じ位置に重なるため、表示中はその高さぶん（内容56px + 下余白8px = 4rem）
 * さらに上へ逃がす。1024px以上では帯をサイドバーへ移すため、帯の有無によらず下端に置く。
 */
export function fabBottomOffsetClass(hasRunningBar: boolean): string {
  return hasRunningBar
    ? "bottom-[calc(10rem_+_env(safe-area-inset-bottom))] md:bottom-[5.5rem] lg:bottom-6"
    : "bottom-[calc(6rem_+_env(safe-area-inset-bottom))] md:bottom-6";
}
