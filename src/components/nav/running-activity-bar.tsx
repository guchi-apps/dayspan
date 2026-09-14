"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { useState, useTransition } from "react";
import { Square } from "lucide-react";

import { formatElapsed } from "@/components/calendar/activity-format";
import { useNowIso } from "@/components/calendar/use-clock";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { stopRunningActivityNow } from "@/components/nav/stop-running-activity";
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
 */
export function RunningActivityBar({ running }: { running: RunningActivitySummary | null }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const offline = useOffline();
  const nowIso = useNowIso();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 表示・停止の正はサーバー側の running。取り直しで別の値が来たら、その場の状態より優先する
  // （activity-screen.tsx の runningKey と同じ派生stateのパターン）。
  const serverKey = runningKey(running);
  const [knownKey, setKnownKey] = useState(serverKey);
  const [localRunning, setLocalRunning] = useState(running);
  if (knownKey !== serverKey) {
    setKnownKey(serverKey);
    setLocalRunning(running);
    setError(null);
  }

  if (!localRunning) return null;

  const stop = async () => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    const result = await stopRunningActivityNow();
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setLocalRunning(null);
    startTransition(() => router.refresh());
  };

  return (
    <div className="mx-2 mb-2 flex shrink-0 items-center gap-2 rounded-2xl bg-primary-container px-2 py-2 pl-3.5 text-on-primary-container elevation-1">
      {/* 詳しい操作（開始時刻の修正・取り消し）は記録画面に閉じる。ここは止めるまでの最短経路。 */}
      <Link href="/activity" className="flex min-w-0 flex-1 items-center gap-2.5">
        <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="type-body-medium clip-nowrap">
            {error ?? localRunning.title}
          </span>
          {nowIso && !error && (
            <span className="type-title-small tabular-nums">
              {formatElapsed(localRunning.startedAt, nowIso)}
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

/** 記録中の項目が同じものかを比べるための文字列（activity-screen.tsx と同じ考え方）。 */
function runningKey(running: RunningActivitySummary | null): string {
  return running ? `${running.title} ${running.startedAt}` : "";
}

/**
 * 下部ナビの直上に固定位置で置かれたFAB（追加ボタン）の `bottom` オフセット。
 *
 * カレンダー・タスク・買い物リストの各画面には、下部ナビの直上に固定位置のFABがある。
 * この帯が表示されると同じ位置に重なるため、表示中はその高さぶん（内容56px + 下余白8px = 4rem）
 * さらに上へ逃がす。
 */
export function fabBottomOffsetClass(hasRunningBar: boolean): string {
  return hasRunningBar
    ? "bottom-[calc(10rem_+_env(safe-area-inset-bottom))] md:bottom-[5.5rem]"
    : "bottom-[calc(6rem_+_env(safe-area-inset-bottom))] md:bottom-6";
}
