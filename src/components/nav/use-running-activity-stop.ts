"use client";

import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { useState, useTransition } from "react";

import { useNowIso } from "@/components/calendar/use-clock";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { stopRunningActivityNow } from "@/components/nav/stop-running-activity";
import type { RunningActivitySummary } from "@/types/activity";

/**
 * 記録中の1件を画面の端に出し、その場で止めるための状態（issue #629・#636）。
 *
 * 狭い画面では下部ナビの直上の帯（running-activity-bar.tsx）、1024px以上ではサイドバーの
 * 下端のカード（app-sidebar.tsx）が使う。両方とも同じ画面に描かれ（CSSで片方を隠す）、
 * 片方で止めると取り直しで届いた running が変わるため、もう片方もここで追随する。
 */
export function useRunningActivityStop(running: RunningActivitySummary | null) {
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

  return { running: localRunning, nowIso, busy, error, offline, stop };
}

/** 記録中の項目が同じものかを比べるための文字列（activity-screen.tsx と同じ考え方）。 */
function runningKey(running: RunningActivitySummary | null): string {
  return running ? `${running.title} ${running.startedAt}` : "";
}
