"use client";

import { useEffect } from "react";

/**
 * オフラインで開けるようにしておく画面のパス（issue #321、docs/spec.md §21）。
 *
 * Service Worker が保存できるのはブラウザのナビゲーション要求だけで、ナビからの移動は
 * ソフトナビゲーション（RSC）になり保存されない。そのため、開いている画面が自分のパスを
 * Service Worker へ渡し、HTMLを先に取って保存してもらう。
 *
 * 温めるのは自分の画面だけにする。他の画面のぶんまで温めると、開いてもいない画面のために
 * Google・Notionへの往復が増える（docs/spec.md §20）。
 *
 * 取り直しの間引きは Service Worker 側（WARM_MAX_AGE_MS）が持つため、ここは素朴に送るだけでよい。
 */
export function useWarmOfflinePage(path: string): void {
  useEffect(() => {
    const warm = () => {
      navigator.serviceWorker?.ready
        .then((registration) =>
          registration.active?.postMessage({ type: "dayspan:warm", paths: [path] }),
        )
        .catch(() => {
          // Service Worker が居ない環境（開発サーバー・非対応ブラウザ）では何もしなくてよい。
        });
    };

    warm();

    // 通信が戻ったとき・画面に戻ってきたときにも温め直す。オフラインへ入る前の内容が
    // 古いままだと、次にオフラインで開いたときにその古い内容が出る。
    const onVisible = () => {
      if (document.visibilityState === "visible") warm();
    };

    window.addEventListener("online", warm);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener("online", warm);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [path]);
}

/**
 * そのパスの画面が保存済みか（issue #321）。
 *
 * オフライン中のナビの移動をハードナビゲーションへ切り替えてよいかの判定に使う。
 * 保存されていないのにハードナビゲーションすると、ブラウザのオフラインエラー画面へ落ちて
 * アプリごと失う。保存されていなければソフトナビゲーションのままにして、
 * useOffline（next/offline）に再接続まで保留させる。
 *
 * CacheStorage は window からも読める。クエリ違い（?view=&date=）は Service Worker 側の
 * 照合でも同じ画面として扱うため、ここでも ignoreSearch で見る。
 */
export async function hasOfflinePage(path: string): Promise<boolean> {
  if (typeof caches === "undefined") return false;

  try {
    return Boolean(await caches.match(path, { ignoreSearch: true }));
  } catch {
    return false;
  }
}
