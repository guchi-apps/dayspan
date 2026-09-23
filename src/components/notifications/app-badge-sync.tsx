"use client";

import { useEffect } from "react";
import { useOffline } from "next/offline";

import { isOfflineNow } from "@/components/offline/offline-state";
import {
  isBadgeStale,
  markBadgeAttempted,
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
 * 増える（docs/spec.md §20）。取り直すのは前回の試行から10分たっているときだけにし、
 * それまでは前回の件数をそのまま使う。試行は成否によらず数える（片側が失敗し続けても、
 * 画面を開くたびに取りにいかない）。
 *
 * タスク・買い物の画面は自分の側を取得済みの一覧から数えて渡す。取りにいくのは残りの側だけで、
 * 同じ全件取得をバッジのためにもう一度Notionへ投げない。
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
    if (Object.keys(known).length > 0) writeBadgeCounts(known);

    const stored = readBadgeCounts();
    applyTotal(stored.tasks, stored.shopping);

    if (isOfflineNow(offline)) return;
    if (!isBadgeStale()) return;

    // 画面が渡した側は取りにいかない。両方渡されていれば何もしない。
    const needTasks = typeof tasks !== "number";
    const needShopping = typeof shopping !== "number";
    if (!needTasks && !needShopping) return;
    const url =
      needTasks && needShopping
        ? "/api/tasks/badge"
        : `/api/tasks/badge?only=${needTasks ? "tasks" : "shopping"}`;

    // 始めた時点で記録する。応答を待つ間に再描画されても二重に取りにいかない。
    markBadgeAttempted();

    void (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok) return;

        const body = (await response.json()) as {
          tasks?: number | null;
          shopping?: number | null;
        };

        // 取れなかった側（null）は前回の件数のまま。書き換えると「1件も無い」ことになる。
        // 画面を離れた後に届いても書く。件数は画面をまたいで共有しており、捨てると10分待つことになる。
        writeBadgeCounts({
          ...(needTasks && typeof body.tasks === "number" ? { tasks: body.tasks } : {}),
          ...(needShopping && typeof body.shopping === "number" ? { shopping: body.shopping } : {}),
        });
        const next = readBadgeCounts();
        applyTotal(next.tasks, next.shopping);
      } catch {
        // 取れなければ前回の件数のまま。バッジを消すと「1件も無い」ことになってしまう。
      }
    })();
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
