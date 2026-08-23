"use client";

import { useEffect } from "react";
import { useOffline } from "next/offline";

import { isOfflineNow } from "@/components/offline/offline-state";

/**
 * アプリアイコンのバッジを、期限が今日以前の未完了タスクの件数に合わせる（docs/spec.md §32）。
 *
 * アプリを閉じている間に件数を動かせるのは通知が届いたときだけ（iOSは通知を出さないプッシュを
 * 認めない）。開いている間はこちらで合わせる。
 *
 * 数える元はNotionにしか無いため、画面を開くたびに取りにいくと外部APIへの往復が画面の数だけ
 * 増える（docs/spec.md §20）。取り直すのは前回から10分たっているときだけにし、それまでは
 * 前回の件数をそのまま使う（Service Workerのウォームアップと同じ間隔の考え方）。
 */

const COUNT_KEY = "dayspan:badge-count";
const CHECKED_AT_KEY = "dayspan:badge-checked-at";
const MAX_AGE_MS = 10 * 60 * 1000;

export function AppBadgeSync({ count }: { count?: number | null }) {
  const offline = useOffline();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) return;

    // タスク画面のように、すでに手元に件数がある画面はそれを使う。取りにいく理由が無い。
    if (count !== undefined && count !== null) {
      applyBadge(count);
      remember(count);
      return;
    }

    const cached = readCount();
    if (cached !== null) applyBadge(cached);

    if (isOfflineNow(offline)) return;
    if (!isStale()) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/tasks/badge");
        if (!response.ok) return;

        const body = (await response.json()) as { count?: number | null };
        if (cancelled || typeof body.count !== "number") return;

        applyBadge(body.count);
        remember(body.count);
      } catch {
        // 取れなければ前回の件数のまま。バッジを消すと「タスクが無い」ことになってしまう。
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [count, offline]);

  return null;
}

function applyBadge(count: number): void {
  // 0は「今日までのタスクが無い」。clearAppBadge と同じで印が消える。
  const badge = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };

  if (count > 0) {
    void badge.setAppBadge?.(count).catch(() => {});
    return;
  }

  void (badge.clearAppBadge?.() ?? badge.setAppBadge?.(0))?.catch(() => {});
}

function remember(count: number): void {
  try {
    localStorage.setItem(COUNT_KEY, String(count));
    localStorage.setItem(CHECKED_AT_KEY, String(Date.now()));
  } catch {
    // プライベートモードなどで書けないことがある。次に開いたときに取り直すだけで済む。
  }
}

function readCount(): number | null {
  try {
    const value = Number(localStorage.getItem(COUNT_KEY));
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function isStale(): boolean {
  try {
    const checkedAt = Number(localStorage.getItem(CHECKED_AT_KEY));
    if (!Number.isFinite(checkedAt) || checkedAt <= 0) return true;
    return Date.now() - checkedAt > MAX_AGE_MS;
  } catch {
    return true;
  }
}
