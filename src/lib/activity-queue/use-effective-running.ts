"use client";

import { useMemo } from "react";

import { applyPendingOps } from "@/lib/activity-queue/ops";
import { usePendingOps } from "@/lib/activity-queue/store";

/**
 * サーバーの記録に、まだ届いていない操作を重ねた「いまの見かけ」の記録（issue #974）。
 * オフライン中に始めた・止めた記録を、画面・記録中バー・サイドバーに同じように映す。
 */
export function useEffectiveRunning<T extends { title: string; startedAt: string }>(
  server: T | null,
) {
  const ops = usePendingOps();
  return useMemo(() => applyPendingOps(server, ops), [server, ops]);
}
