"use client";

import { useEffect } from "react";

/**
 * public/sw.js を登録する（docs/spec.md §21）。
 *
 * オフラインでの再読み込みは、ブラウザがHTMLを取りにいく時点で失敗する。
 * next.config.ts の experimental.useOffline はソフトナビゲーションしか肩代わりしないため、
 * 起動・再読み込みを賄うにはService Workerが要る。
 *
 * 描画するものは無い。ログイン後の画面（レイアウト）に1つ置いておけばよい。
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // 開発中は毎回中身が変わる。取得した内容が保存済みのものに差し替わると原因が追いにくいため、
    // 登録するのは本番ビルドのときだけにする。
    if (process.env.NODE_ENV !== "production") return;

    // updateViaCache: "none" にしないと、ブラウザのHTTPキャッシュのせいで
    // 古い sw.js のまま更新されないことがある。
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // 登録できなくてもオンラインでの利用には影響しない。画面に出す必要はない。
    });
  }, []);

  return null;
}
