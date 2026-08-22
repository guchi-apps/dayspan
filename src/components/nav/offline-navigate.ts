"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";

import { hasOfflinePage } from "@/components/offline/offline-page-cache";
import { isOfflineNow } from "@/components/offline/offline-state";

/**
 * 新しいタブで開こうとしていない、素のクリックか。
 *
 * オフライン中の差し替えは同じタブでの移動なので、Ctrl・Command・中クリックのように
 * 別のタブ・ウィンドウを開く操作までここで奪うと、押した結果が変わってしまう。
 */
export function isPlainClick(event: React.MouseEvent): boolean {
  return (
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
  );
}

/**
 * オフライン中の画面移動（issue #321）。
 *
 * ナビの移動はソフトナビゲーション（RSC要求）で、Service Worker は保存していない。
 * 応答の中身が Next-Router-State-Tree や先読みかどうかで変わり、別の状況で再生すると
 * 描画が壊れるためである（public/sw.js）。そのままだとオフラインでは
 * experimental.useOffline が要求を再接続まで保留し、骨組みが出たまま止まる。
 *
 * 保存済みのページがあるときは、ハードナビゲーションへ切り替えて Service Worker に
 * 返させる。起動・再読み込みでオフラインでも開けている経路をそのまま使う。
 * 保存が無ければ従来どおり保留する（オフラインエラー画面へ落とさない）。
 *
 * 判定に isOfflineNow() を使うのは、オフラインのままPWAを起動した直後だと
 * useOffline() がまだ false のためである。ページもJSも Service Worker が返すので
 * 要求が1つも失敗せず、まさにこのIssueの場面で切り替えが効かない。
 *
 * 返るのは「移動を引き受けたか」。真ならリンクの既定動作を止める。
 */
export function useOfflineNavigate() {
  const router = useRouter();
  const offline = useOffline();

  return useCallback(
    (href: string) => {
      if (!isOfflineNow(offline)) return false;

      void hasOfflinePage(href).then((cached) => {
        if (cached) window.location.assign(href);
        else router.push(href);
      });

      return true;
    },
    [offline, router],
  );
}
