"use client";

import { useEffect, useRef, useState } from "react";

// 日表示の左右スワイプ。前後の期間を左右に並べておき、指が動いたぶんだけ横へずらす。
// 送ると決まったら残りをアニメーションで詰め、期間そのものの切り替えは呼び出し側に任せる。
//
// 縦スクロール・予定のドラッグと同じ面の上で起きる操作なので、どちらに動かしたのかが
// はっきりするまでは何もしない。取り違えると、スクロールのつもりで日付が変わってしまう。

/** 横に振ったと判断する最小移動量。これ未満は縦スクロールやタップの揺れと区別できない。 */
const AXIS_LOCK_PX = 12;

/** 日付を送るのに必要な移動量（表示幅に対する割合）。 */
const COMMIT_RATIO = 0.22;

/** 大きく動かさなくても送れるようにするための速度（px/ms）。素早く払う操作を拾う。 */
const COMMIT_VELOCITY = 0.4;

/** 指を離してから隣の期間へ収まるまでの時間。M3の標準的な長さに合わせる。 */
export const SWIPE_SNAP_MS = 220;

/** 収まるときの緩急。M3のemphasized decelerateに相当し、指を離したあとが自然に減速する。 */
export const SWIPE_SNAP_EASING = "cubic-bezier(0.05, 0.7, 0.1, 1)";

export type DaySwipe = {
  /** 表示の横位置。1で1期間ぶん右（＝前の期間が見えている状態）。 */
  offset: number;
  /** 指を離したあとの吸着中か。trueのあいだだけCSSのトランジションを効かせる。 */
  snapping: boolean;
  /** 指の操作を受け取る要素。表示中の期間の全体を覆う。 */
  rootRef: React.RefObject<HTMLDivElement | null>;
  /** 1期間ぶんの幅を測る要素。移動量を「何期間ぶんか」に直すために使う。 */
  trackRef: React.RefObject<HTMLDivElement | null>;
  handlers: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
    onPointerCancel: (event: React.PointerEvent) => void;
  };
};

type Origin = {
  x: number;
  y: number;
  time: number;
  width: number;
};

export function useDaySwipe({
  daysKey,
  enabled,
  onSwipe,
}: {
  /** 表示中の期間を表す値。これが変わったら送り先が画面に出たとみなす。 */
  daysKey: string;
  /** 予定のドラッグ中など、横の動きを日付の移動として扱ってはいけない間は false。 */
  enabled: boolean;
  onSwipe: (direction: 1 | -1) => void;
}): DaySwipe {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const originRef = useRef<Origin | null>(null);
  const axisRef = useRef<"undecided" | "horizontal">("undecided");
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [offset, setOffset] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const [shownKey, setShownKey] = useState(daysKey);

  // 送り先の期間が画面に反映されてから、寄せていた位置を戻す。先に戻すと、隣の期間が
  // 出るまでの一瞬だけ元の期間へ跳ね返って見える。
  if (shownKey !== daysKey) {
    setShownKey(daysKey);
    setOffset(0);
    setSnapping(false);
  }

  useEffect(
    () => () => {
      if (snapTimerRef.current !== null) clearTimeout(snapTimerRef.current);
    },
    [],
  );

  const cancelGesture = () => {
    originRef.current = null;
    axisRef.current = "undecided";
  };

  const onPointerDown = (event: React.PointerEvent) => {
    // 指以外は対象外。マウスの横移動は予定のドラッグで使っており、日付の移動は前へ・次へで行う。
    if (event.pointerType !== "touch") return;
    // 吸着中に触られると、どの期間を動かしているのか決まらない。落ち着くまで受け付けない。
    if (snapTimerRef.current !== null) return;

    originRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      width: Math.max(trackRef.current?.clientWidth ?? 0, 1),
    };
    axisRef.current = "undecided";
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const origin = originRef.current;
    if (!origin) return;

    if (!enabled) {
      // 予定のドラッグが成立した。この指の動きは予定のものなので日付は動かさない。
      cancelGesture();
      setOffset(0);
      return;
    }

    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;

    if (axisRef.current === "undecided") {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;

      // 縦のほうが大きければスクロール。以降この指では日付を送らない。
      if (Math.abs(dx) <= Math.abs(dy)) {
        cancelGesture();
        return;
      }

      axisRef.current = "horizontal";
      // 判定に使ったぶんを起点から差し引く。そのままだと表示が指より先に飛ぶ。
      origin.x += Math.sign(dx) * AXIS_LOCK_PX;
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    const ratio = (event.clientX - origin.x) / origin.width;
    setOffset(Math.min(Math.max(ratio, -1), 1));
  };

  /** 吸着させる。direction が 0 なら元の位置へ戻す。 */
  const settle = (direction: 1 | -1 | 0) => {
    setSnapping(true);

    if (direction === 0) {
      setOffset(0);
      snapTimerRef.current = setTimeout(() => {
        snapTimerRef.current = null;
        setSnapping(false);
      }, SWIPE_SNAP_MS);
      return;
    }

    // 隣の期間が画面いっぱいに来るまで動かしきってから、期間そのものを切り替える。
    setOffset(-direction);
    snapTimerRef.current = setTimeout(() => {
      snapTimerRef.current = null;
      onSwipe(direction);
    }, SWIPE_SNAP_MS);
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const origin = originRef.current;
    const wasHorizontal = axisRef.current === "horizontal";
    cancelGesture();

    if (!origin || !wasHorizontal) return;

    const dx = event.clientX - origin.x;
    const ratio = dx / origin.width;
    const velocity = dx / Math.max(event.timeStamp - origin.time, 1);

    // 移動量か速度のどちらかが足りていれば送る。ゆっくり大きく動かす操作と、
    // 素早く払う操作のどちらでも同じように日付が変わるようにする。
    const direction: 1 | -1 | 0 =
      ratio <= -COMMIT_RATIO || velocity <= -COMMIT_VELOCITY
        ? 1
        : ratio >= COMMIT_RATIO || velocity >= COMMIT_VELOCITY
          ? -1
          : 0;

    settle(direction);
  };

  // 端末側のジェスチャーなどで取り上げられた場合。どこまで動かすつもりだったかは
  // 分からないため、日付は送らず元の位置へ戻す。
  const onPointerCancel = () => {
    const wasHorizontal = axisRef.current === "horizontal";
    cancelGesture();
    if (wasHorizontal) settle(0);
  };

  return {
    offset,
    snapping,
    rootRef,
    trackRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  };
}
