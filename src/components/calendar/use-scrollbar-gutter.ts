"use client";

import { useEffect, useLayoutEffect, useState } from "react";

// サーバー描画では useLayoutEffect は動かず警告になる。ヘッダーの余白は画面に出る前に
// 決めないと、揃っていない状態が一瞬見えるため、ブラウザでだけレイアウト効果を使う。
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * 縦スクロール領域が実際に取っているスクロールバーの幅（px）。
 *
 * 日付ヘッダー・終日エリアはスクロール領域の外にあるため、パソコンのように場所を取る
 * スクロールバーが出る環境では、スクロール領域だけが幅を削られて列の境目が横にずれる
 * （issue #136）。同じ幅をヘッダー側の右へ空けて揃えるために測る。
 * 指で操作する環境ではスクロールバーが内容へ重なって出るため 0 になり、余白は空かない。
 *
 * 対象の要素に左右の境界線を引くと、その幅もここに含まれてしまう点に注意する。
 */
export function useScrollbarGutter(scrollRef: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useIsomorphicLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    // 幅が変わるのは画面の大きさが変わったときと、スクロールバーが出入りしたとき。
    // どちらも内容の箱の幅が動くため ResizeObserver で拾える。
    const measure = () => setWidth(element.offsetWidth - element.clientWidth);

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, [scrollRef]);

  return width;
}
