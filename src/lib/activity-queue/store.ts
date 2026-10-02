"use client";

import { useSyncExternalStore } from "react";

import type { PendingOp } from "@/lib/activity-queue/ops";

const KEY = "dayspan:activity-queue:v1";
const EMPTY: PendingOp[] = [];

/** 画面側が購読する。保存した操作が変わったとき、同じタブと他のタブの両方へ知らせる。 */
const listeners = new Set<() => void>();
let cache: { raw: string | null; ops: PendingOp[] } = { raw: null, ops: EMPTY };

function notify() {
  for (const listener of listeners) listener();
}

/** 保存済みの操作。読めない・壊れた値は空として扱う（キューが原因で画面が開けなくならないように）。 */
export function readQueue(): PendingOp[] {
  if (typeof localStorage === "undefined") return EMPTY;

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }

  // useSyncExternalStore は同じ値で同じ参照を返すことを求める。
  if (raw === cache.raw) return cache.ops;

  let ops: PendingOp[] = EMPTY;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) ops = parsed as PendingOp[];
    } catch {
      ops = EMPTY;
    }
  }

  cache = { raw, ops };
  return ops;
}

export function writeQueue(ops: PendingOp[]): void {
  try {
    if (ops.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(ops));
  } catch {
    // 保存できない環境（容量・プライベートモード）では、このタブの中だけで動かす。
    cache = { raw: null, ops: ops.length === 0 ? EMPTY : ops };
  }
  notify();
}

/** ログアウト・別アカウントへの切り替えで、前のユーザーの操作を残さない。 */
export function clearQueue(): void {
  writeQueue([]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** まだサーバーへ届いていない操作。サーバー描画では常に空。 */
export function usePendingOps(): PendingOp[] {
  return useSyncExternalStore(subscribe, readQueue, () => EMPTY);
}

/** 同期の進み具合（保存はしない。このタブの中だけ）。 */
type SyncState = { flushing: boolean; authRequired: boolean };
let syncState: SyncState = { flushing: false, authRequired: false };

export function setSyncState(next: Partial<SyncState>): void {
  syncState = { ...syncState, ...next };
  notify();
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    subscribe,
    () => syncState,
    () => syncState,
  );
}
