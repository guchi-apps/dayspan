"use client";

import { useEffect } from "react";

/**
 * 起動画面（AppLaunchScreen）を消す合図を出す。
 *
 * <html> に data-app-ready を立てるだけで、消し方そのものは globals.css が持つ。
 * ここが動くのはハイドレーションが済んだあと、つまり画面が実際に操作を受けられるようになった
 * 時点。先に消すと、押しても何も起きない画面を見せることになる。
 *
 * 属性はいちど立てたら外さない。ソフトナビゲーションのたびに起動画面が出直すと、
 * 画面を移るだけで全面のアイコンが挟まる。
 */
export function AppReady() {
  useEffect(() => {
    document.documentElement.dataset.appReady = "";
  }, []);

  return null;
}
