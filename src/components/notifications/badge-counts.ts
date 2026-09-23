"use client";

import { useSyncExternalStore } from "react";

/**
 * 下部ナビのバッジとアイコンのバッジが読む、タスク・買い物の件数（docs/spec.md §32）。
 *
 * 数える元はNotionにしか無いため、画面を移るたびに取りにいくと外部APIへの往復が増える
 * （§20）。取り直しは AppBadgeSync が10分に1回までに絞り、その結果をここへ置く。
 * 下部ナビは画面ごとに作り直されるので、localStorage に置いて次の画面でもすぐ読めるようにする。
 */

export type StoredBadgeCounts = { tasks: number | null; shopping: number | null };

const TASKS_KEY = "dayspan:badge-tasks";
const SHOPPING_KEY = "dayspan:badge-shopping";
// 取り直しを試みた時刻。成否によらず記録し、片側が失敗し続けても10分に1回までに収める。
// 名前を以前の "dayspan:badge-checked-at" から変えているのは、旧版が残した時刻のせいで
// 件数がまだ1つも無い端末の取得が最大10分遅れないようにするため。
const ATTEMPTED_AT_KEY = "dayspan:badge-attempted-at";
const CHANGE_EVENT = "dayspan:badge-counts";

export const BADGE_MAX_AGE_MS = 10 * 60 * 1000;

function readNumber(key: string): number | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function readBadgeCounts(): StoredBadgeCounts {
  return { tasks: readNumber(TASKS_KEY), shopping: readNumber(SHOPPING_KEY) };
}

export function isBadgeStale(): boolean {
  const attemptedAt = readNumber(ATTEMPTED_AT_KEY);
  return attemptedAt === null || attemptedAt <= 0 || Date.now() - attemptedAt > BADGE_MAX_AGE_MS;
}

/** 取り直しを始めたことを残す。以後10分は取りにいかない。 */
export function markBadgeAttempted(): void {
  try {
    localStorage.setItem(ATTEMPTED_AT_KEY, String(Date.now()));
  } catch {
    // 書けなければ次に開いたときにもう一度取りにいくだけ。
  }
}

/** 渡した側だけ書き換える。 */
export function writeBadgeCounts(next: Partial<StoredBadgeCounts>): void {
  try {
    if (typeof next.tasks === "number") localStorage.setItem(TASKS_KEY, String(next.tasks));
    if (typeof next.shopping === "number") localStorage.setItem(SHOPPING_KEY, String(next.shopping));
  } catch {
    // 書けなければ次に開いたときに取り直すだけ。
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** タスク・買い物の件数。サーバー描画と水和の間は null（未取得）で、一致させる。 */
export function useBadgeCount(kind: "tasks" | "shopping"): number | null {
  return useSyncExternalStore(
    subscribe,
    () => readBadgeCounts()[kind],
    () => null,
  );
}
