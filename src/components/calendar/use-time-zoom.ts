"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  DEFAULT_HOUR_HEIGHT,
  MAX_HOUR_HEIGHT,
  MIN_HOUR_HEIGHT,
} from "./item-layout";

// 時間グリッドの縦の倍率を、2本指のピンチで変える（docs/spec.md §6）。
//
// 触っている場所を動かさないまま広げる・縮めるには、高さを変えるのと同時に
// スクロール位置もずらす必要がある。高さだけ変えると、指の下にあった時刻が
// 画面の外へ流れていき、どこを見ていたのか分からなくなる。
//
// 判定にはpointerイベントではなくtouchイベントを使う。2本目の指が乗った時点で
// ブラウザは2本指のスクロールを始めており、これを止められるのは
// 非パッシブのtouchmoveでのpreventDefaultだけのため（use-grid-drag.ts と同じ理由）。
// 止めたぶん、2本指のまま動かしたときの縦スクロールはこちらで受け持つ。
// 指の間隔が変わらなければ倍率も変わらないので、そのまま2本指のスクロールとして働く。

/** 倍率は端末ごとの見やすさの設定なので、画面を開き直しても保つ。 */
const STORAGE_KEY = "dayspan:time-grid:hour-height";

/** 書き込みが指の動きに巻き込まれないよう、落ち着いてから保存する。 */
const STORE_DEBOUNCE_MS = 300;

/**
 * ピンチのあとに残るclickを無視する時間。
 *
 * 指を離した順によっては、最後の1本がタップとして扱われて予定や空き時間の画面が開く。
 * 拡大しただけで入力画面が出ると、閉じるまで元の画面を確認できない。
 */
const CLICK_SUPPRESS_MS = 500;

/** ホイールでの倍率の変わりやすさ。1ノッチ（約100）でおよそ1.4倍になる。 */
const WHEEL_SENSITIVITY = 280;

function clamp(value: number): number {
  return Math.min(Math.max(value, MIN_HOUR_HEIGHT), MAX_HOUR_HEIGHT);
}

// --- 倍率の保管 ---
// 倍率はこの端末の見やすさの設定であって、描画のたびに決まる値ではない。
// localStorage という React の外にある状態として扱い、購読して読む。
// サーバー側には無い値なので、初回の描画では既定値を返してハイドレーションを一致させる。

let currentHourHeight: number | null = null;
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

function getHourHeight(): number {
  if (currentHourHeight === null) currentHourHeight = readStored() ?? DEFAULT_HOUR_HEIGHT;
  return currentHourHeight;
}

function getServerHourHeight(): number {
  return DEFAULT_HOUR_HEIGHT;
}

function subscribeHourHeight(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setHourHeight(value: number): void {
  if (value === getHourHeight()) return;

  currentHourHeight = value;
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

export type TimeZoom = {
  /** 1時間あたりの高さ（px）。 */
  hourHeight: number;
  /** ピンチ中か。横スワイプ・ドラッグと取り違えないよう、この間は他の操作を止める。 */
  pinching: boolean;
  /** 倍率を変える対象。縦スクロールを持つ要素に付ける。 */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** ピンチ直後のclickかどうか。trueなら押された扱いにしない。 */
  consumePinchClick: () => boolean;
};

export function useTimeZoom({
  /** ピンチが始まったときに呼ぶ。掴みかけの予定を取りやめるために使う。 */
  onPinchStart,
}: {
  onPinchStart: () => void;
}): TimeZoom {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const hourHeight = useSyncExternalStore(
    subscribeHourHeight,
    getHourHeight,
    getServerHourHeight,
  );
  const [pinching, setPinching] = useState(false);

  /** 高さを変えたあとに合わせるスクロール位置。描画のあとで当てる。 */
  const pendingScrollRef = useRef<number | null>(null);
  const pinchEndedAtRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(hourHeight));
      } catch {
        // 保存できなくても、その画面を開いている間の倍率は保てる。
      }
    }, STORE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [hourHeight]);

  // 高さが変わったあと、ブラウザが描き直す前にスクロール位置を合わせる。
  // 描画後に回すと、一瞬だけ指の下と違う時刻が見える。
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

    /** ピンチを始めた時点の指の間隔・倍率と、指の中点が指していた中身の位置。 */
    let origin: { distance: number; hourHeight: number; contentY: number } | null = null;

    /**
     * 倍率を変えつつ、掴んでいる位置を指の下に留める。
     *
     * contentY は掴んだ時点で指が指していた「中身の上端からの距離」、
     * anchorY はいま指がある「要素の上端からの距離」。中身は倍率と同じだけ伸びるので、
     * 伸びた後の位置を指の下へ持ってくるようスクロール位置を決める。
     */
    const zoomTo = (next: number, from: number, contentY: number, anchorY: number) => {
      const scrollTop = (contentY * next) / from - anchorY;

      // 倍率が変わらない場合（2本指のまま動かした・端まで来た）は、位置だけ合わせる。
      // ブラウザのスクロールは止めてあるため、ここで動かさないと画面が固まって見える。
      if (next === getHourHeight()) {
        element.scrollTop = scrollTop;
        return;
      }

      pendingScrollRef.current = scrollTop;
      setHourHeight(next);
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
        hourHeight: getHourHeight(),
        contentY: element.scrollTop + (touchCenterY(event.touches) - rect.top),
      };
      // 予定を掴みかけていた場合、この指の動きは予定のものではない。
      onPinchStart();
      setPinching(true);
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!origin || event.touches.length !== 2) return;

      // ブラウザの2本指スクロールを止める。これをしないと、倍率と同時に画面も流れる。
      event.preventDefault();

      const rect = element.getBoundingClientRect();
      const scale = touchDistance(event.touches) / origin.distance;
      zoomTo(
        clamp(Math.round(origin.hourHeight * scale)),
        origin.hourHeight,
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

    /** トラックパッドのピンチ・Ctrl+ホイール。ブラウザの拡大ではなく時間の幅を変える。 */
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;

      event.preventDefault();

      const rect = element.getBoundingClientRect();
      const current = getHourHeight();
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

  return { hourHeight, pinching, scrollRef, consumePinchClick };
}
