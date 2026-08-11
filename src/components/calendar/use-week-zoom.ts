"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

// 月表示の週の高さを、2本指のピンチで変える。仕組みは use-time-zoom.ts（1日・3日表示の
// 時間幅ピンチ）と同じで、対象を「1時間あたりの高さ」から「1週あたりの高さ」に置き換えただけ。
//
// 月表示のスクロール領域も、週の高さ×週の数がそのままコンテンツの高さになる連続スクロールで、
// 時間グリッドと同じ座標の持ち方（scrollTop = コンテンツ上の絶対位置）をしている。そのため
// 「指の中点が指している位置を動かさないまま高さを変える」計算式もそのまま使える。

/** 倍率は端末ごとの見やすさの設定なので、画面を開き直しても保つ。 */
const STORAGE_KEY = "dayspan:month:week-height";

/** 書き込みが指の動きに巻き込まれないよう、落ち着いてから保存する。 */
const STORE_DEBOUNCE_MS = 300;

/**
 * ピンチのあとに残るclickを無視する時間。
 *
 * 指を離した順によっては、最後の1本がタップとして扱われ、日の1日表示や簡易入力が開く。
 * 拡大しただけでそれらの画面が出ると、閉じるまで月表示へ戻れない。
 */
const CLICK_SUPPRESS_MS = 500;

/** ホイールでの倍率の変わりやすさ。1ノッチ（約100）でおよそ1.4倍になる。 */
const WHEEL_SENSITIVITY = 280;

/** 週の高さの初期値（px）。時間グリッドと同じく、これ自体はピンチで変わるため定数ではなく初期値。 */
export const DEFAULT_WEEK_HEIGHT = 112;
// 時間グリッドの縦軸と同じ「既定の1/2〜4倍」の範囲に揃える（docs/spec.md §6）。
export const MIN_WEEK_HEIGHT = 56;
export const MAX_WEEK_HEIGHT = 448;

function clamp(value: number): number {
  return Math.min(Math.max(value, MIN_WEEK_HEIGHT), MAX_WEEK_HEIGHT);
}

// --- 倍率の保管 ---
// 倍率はこの端末の見やすさの設定であって、描画のたびに決まる値ではない。
// localStorage という React の外にある状態として扱い、購読して読む。
// サーバー側には無い値なので、初回の描画では既定値を返してハイドレーションを一致させる。

let currentWeekHeight: number | null = null;
const listeners = new Set<() => void>();

function readStored(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;

    const value = Number(raw);
    return Number.isFinite(value) ? clamp(value) : null;
  } catch {
    // プライベートモードなど読み書きできない環境では、既定の倍率のまま使う。
    return null;
  }
}

function getWeekHeight(): number {
  if (currentWeekHeight === null) currentWeekHeight = readStored() ?? DEFAULT_WEEK_HEIGHT;
  return currentWeekHeight;
}

function getServerWeekHeight(): number {
  return DEFAULT_WEEK_HEIGHT;
}

function subscribeWeekHeight(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setWeekHeight(value: number): void {
  if (value === getWeekHeight()) return;

  currentWeekHeight = value;
  for (const listener of listeners) listener();
}

function touchDistance(touches: TouchList): number {
  return Math.max(
    Math.hypot(
      touches[0].clientX - touches[1].clientX,
      touches[0].clientY - touches[1].clientY,
    ),
    1,
  );
}

function touchCenterY(touches: TouchList): number {
  return (touches[0].clientY + touches[1].clientY) / 2;
}

export type WeekZoom = {
  /** 週の高さ（px）。 */
  weekHeight: number;
  /** ピンチ中か。日を押す・長押しする操作と取り違えないよう、この間は他の操作を止める。 */
  pinching: boolean;
  /** 倍率を変える対象。月表示のスクロール領域に付ける。 */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** ピンチ直後のclickかどうか。trueなら押された扱いにしない。 */
  consumePinchClick: () => boolean;
};

export function useWeekZoom({
  /** ピンチが始まったときに呼ぶ。掴みかけの長押しを取りやめるために使う。 */
  onPinchStart,
}: {
  onPinchStart: () => void;
}): WeekZoom {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const weekHeight = useSyncExternalStore(
    subscribeWeekHeight,
    getWeekHeight,
    getServerWeekHeight,
  );
  const [pinching, setPinching] = useState(false);

  /** 高さを変えたあとに合わせるスクロール位置。描画のあとで当てる。 */
  const pendingScrollRef = useRef<number | null>(null);
  const pinchEndedAtRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(weekHeight));
      } catch {
        // 保存できなくても、その画面を開いている間の倍率は保てる。
      }
    }, STORE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [weekHeight]);

  // 高さが変わったあと、ブラウザが描き直す前にスクロール位置を合わせる。
  // 描画後に回すと、一瞬だけ指の下と違う週が見える。
  useLayoutEffect(() => {
    const pending = pendingScrollRef.current;
    if (pending === null) return;

    pendingScrollRef.current = null;
    const element = scrollRef.current;
    // 上下の端は、ブラウザが範囲内へ収めてくれる。
    if (element) element.scrollTop = pending;
  });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    /** ピンチを始めた時点の指の間隔・高さと、指の中点が指していた中身の位置。 */
    let origin: { distance: number; weekHeight: number; contentY: number } | null = null;

    /**
     * 高さを変えつつ、掴んでいる位置を指の下に留める。
     *
     * contentY は掴んだ時点で指が指していた「中身の上端からの距離」、
     * anchorY はいま指がある「要素の上端からの距離」。中身は高さと同じだけ伸びるので、
     * 伸びた後の位置を指の下へ持ってくるようスクロール位置を決める。
     */
    const zoomTo = (next: number, from: number, contentY: number, anchorY: number) => {
      const scrollTop = (contentY * next) / from - anchorY;

      // 高さが変わらない場合（2本指のまま動かした・端まで来た）は、位置だけ合わせる。
      // ブラウザのスクロールは止めてあるため、ここで動かさないと画面が固まって見える。
      if (next === getWeekHeight()) {
        element.scrollTop = scrollTop;
        return;
      }

      pendingScrollRef.current = scrollTop;
      setWeekHeight(next);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) {
        // 3本目が乗った時点で、始めたときの指の間隔は当てにならない。
        origin = null;
        return;
      }

      const rect = element.getBoundingClientRect();
      origin = {
        distance: touchDistance(event.touches),
        weekHeight: getWeekHeight(),
        contentY: element.scrollTop + (touchCenterY(event.touches) - rect.top),
      };
      // 長押しを掴みかけていた場合、この指の動きはその操作のものではない。
      onPinchStart();
      setPinching(true);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!origin || event.touches.length !== 2) return;

      // ブラウザの2本指スクロールを止める。これをしないと、高さと同時に画面も流れる。
      event.preventDefault();

      const rect = element.getBoundingClientRect();
      const scale = touchDistance(event.touches) / origin.distance;
      zoomTo(
        clamp(Math.round(origin.weekHeight * scale)),
        origin.weekHeight,
        origin.contentY,
        touchCenterY(event.touches) - rect.top,
      );
    };

    const handleTouchEnd = (event: TouchEvent) => {
      // 2本残っていれば、まだピンチの途中（3本目が離れた場合）。
      if (event.touches.length >= 2) return;
      if (origin === null) return;

      origin = null;
      pinchEndedAtRef.current = event.timeStamp;
      setPinching(false);
    };

    /** トラックパッドのピンチ・Ctrl+ホイール。ブラウザの拡大ではなく週の高さを変える。 */
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;

      event.preventDefault();

      const rect = element.getBoundingClientRect();
      const current = getWeekHeight();
      const anchorY = event.clientY - rect.top;
      const scale = Math.exp(-event.deltaY / WHEEL_SENSITIVITY);
      zoomTo(clamp(Math.round(current * scale)), current, element.scrollTop + anchorY, anchorY);
    };

    element.addEventListener("touchstart", handleTouchStart, { passive: true });
    element.addEventListener("touchmove", handleTouchMove, { passive: false });
    element.addEventListener("touchend", handleTouchEnd, { passive: true });
    element.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    element.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchmove", handleTouchMove);
      element.removeEventListener("touchend", handleTouchEnd);
      element.removeEventListener("touchcancel", handleTouchEnd);
      element.removeEventListener("wheel", handleWheel);
    };
  }, [onPinchStart]);

  const consumePinchClick = useCallback(
    () => pinching || performance.now() - pinchEndedAtRef.current < CLICK_SUPPRESS_MS,
    [pinching],
  );

  return { weekHeight, pinching, scrollRef, consumePinchClick };
}
