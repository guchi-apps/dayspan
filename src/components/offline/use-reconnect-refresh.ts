"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";

/**
 * 再接続したときに最新のデータを取り直す（docs/spec.md §21）。
 *
 * オフライン中はServiceWorkerが保存済みの内容を返しているため、戻ってきた時点の画面は
 * オフラインへ入る前の内容のままになる。ここで取り直さないと、いつまでも古いまま残る。
 *
 * useOffline() はハイドレーション中 false を返すため、false のまま始まったときは何もしない。
 * true → false へ変わったときだけ取り直す。
 */
export function useReconnectRefresh(): void {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const offline = useOffline();
  const wasOffline = useRef(false);

  useEffect(() => {
    if (offline) {
      wasOffline.current = true;
      return;
    }

    if (!wasOffline.current) return;
    wasOffline.current = false;

    startTransition(() => router.refresh());
  }, [offline, router]);
}
