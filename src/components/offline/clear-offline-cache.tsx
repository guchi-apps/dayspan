"use client";

import { useEffect } from "react";

/**
 * Service Worker が持っている保存済みの画面を捨てる（docs/spec.md §21）。
 *
 * ログイン画面に置く。この画面が出ているということは、このブラウザにログイン中のユーザーが
 * いないということなので、前のユーザーの予定やタスクを残しておく理由がない。
 * 別のアカウントでログインしたあとにオフラインになったとき、前のユーザーの画面が
 * 出てしまうことを防ぐ。
 *
 * ログアウトのフォーム側ではなくここで消すのは、セッション切れによるログイン画面への
 * 差し戻しも同じように拾えるため。
 */
export function ClearOfflineCache() {
  useEffect(() => {
    navigator.serviceWorker?.ready
      .then((registration) => registration.active?.postMessage({ type: "dayspan:clear-cache" }))
      .catch(() => {
        // Service Worker が居ない環境では何もしなくてよい。
      });
  }, []);

  return null;
}
