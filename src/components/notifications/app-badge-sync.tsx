"use client";

import { useEffect } from "react";
import { useOffline } from "next/offline";

import { isOfflineNow } from "@/components/offline/offline-state";
import {
  isBadgeStale,
  readBadgeCounts,
  writeBadgeCounts,
} from "@/components/notifications/badge-counts";

/**
 * アプリアイコンのバッジを、タスク（期限が今日以前の未完了）と買い物（購入予定日が今日以前の
 * 未購入）の件数の合計に合わせる（docs/spec.md §32）。同じ件数を下部ナビのバッジにも出す。
 *
 * アプリを閉じている間に件数を動かせるのは通知が届いたときだけ（iOSは通知を出さないプッシュを
 * 認めない）。開いている間はこちらで合わせる。
 *
 * 数える元はNotionにしか無いため、画面を開くたびに取りにいくと外部APIへの往復が画面の数だけ
 * 増える（docs/spec.md §20）。取り直すのは前回から10分たっているとき（と、まだ一度も
 * 取れていないとき）だけにし、それまでは前回の件数をそのまま使う。
 */

export function AppBadgeSync({
  tasks,
  shopping,
}: {
  /** すでに手元にあるタスクの件数（タスク画面）。あれば取りにいく理由が無い。 */
  tasks?: number | null;
  /** すでに手元にある買い物の件数（買い物画面）。 */
  shopping?: number | null;
}) {
  const offline = useOffline();

  useEffect(() => {
    if (typeof navigator === "undefined") return;

    const known = {
      ...(typeof tasks === "number" ? { tasks } : {}),
      ...(typeof shopping === "number" ? { shopping } : {}),
    };
    if (Object.keys(known).length > 0) writeBadgeCounts(known, false);

    const stored = readBadgeCounts();
    applyTotal(stored.tasks, stored.shopping);

    if (isOfflineNow(offline)) return;
    // 片方が未取得のままだと合計が出せない。鮮度に関わらず取りにいく。
    const missing = stored.tasks === null || stored.shopping === null;
    if (!missing && !isBadgeStale()) return;

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/tasks/badge");
        if (!response.ok) return;

        const body = (await response.json()) as {
          tasks?: number | null;
          shopping?: number | null;
        };
        if (cancelled) return;

        // 取れなかった側（null）は前回の件数のまま。書き換えると「1件も無い」ことになる。
        writeBadgeCounts(
          {
            ...(typeof body.tasks === "number" ? { tasks: body.tasks } : {}),
            ...(typeof body.shopping === "number" ? { shopping: body.shopping } : {}),
          },
          typeof body.tasks === "number" && typeof body.shopping === "number",
        );
        const next = readBadgeCounts();
        applyTotal(next.tasks, next.shopping);
      } catch {
        // 取れなければ前回の件数のまま。バッジを消すと「1件も無い」ことになってしまう。
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tasks, shopping, offline]);

  return null;
}

function applyTotal(tasks: number | null, shopping: number | null): void {
  if (tasks === null || shopping === null) return;
  if (!("setAppBadge" in navigator)) return;

  const count = tasks + shopping;
  // 0は「対応するものが無い」。clearAppBadge と同じで印が消える。
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
