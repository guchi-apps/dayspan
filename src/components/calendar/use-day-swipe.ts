"use client";

import { useEffect, useRef, useState } from "react";

// 日表示の左右スワイプ。前後の期間を左右に並べておき、指が動いたぶんだけ横へずらす。
// 送ると決まったら残りをアニメーションで詰め、期間そのものの切り替えは呼び出し側に任せる。
//
// 動かす単位は期間ではなく1日。3日表示で3日ずつしか動けないと、
// 「今日を真ん中に置く」「明日から3日を見る」といった見方に切り替えられないため。
// 前後の期間は日付列の幅がそろって並んでいるので、1列ぶんずらせば1日ぶん動く。
//
// 縦スクロール・予定のドラッグと同じ面の上で起きる操作なので、どちらに動かしたのかが
// はっきりするまでは何もしない。取り違えると、スクロールのつもりで日付が変わってしまう。

/** 横に振ったと判断する最小移動量。これ未満は縦スクロールやタップの揺れと区別できない。 */
const AXIS_LOCK_PX = 12;

/** 次の日へ送るのに必要な移動量（日付列1つぶんの幅に対する割合）。 */
const COMMIT_RATIO = 0.35;

/** 大きく動かさなくても送れるようにするための速度（px/ms）。素早く払う操作を拾う。 */
const COMMIT_VELOCITY = 0.4;

/** 指を離してから隣の期間へ収まるまでの時間。M3の標準的な長さに合わせる。 */
export const SWIPE_SNAP_MS = 220;

/** 収まるときの緩急。M3のemphasized decelerateに相当し、指を離したあとが自然に減速する。 */
export const SWIPE_SNAP_EASING = "cubic-bezier(0.05, 0.7, 0.1, 1)";

export type DaySwipe = {
  /** 表示の横位置。1期間ぶんを1とした割合で、1日ぶんは 1/step にあたる。 */
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

/**
 * 指を離した時点で、何日ぶん送るかを決める。
 *
 * dx は指の移動量（px、左が負）、trackWidth は1期間ぶんの幅、step はその期間に並ぶ日数。
 * 正の戻り値で先の日付へ進む。
 */
export function swipeDeltaDays({
  dx,
  velocity,
  trackWidth,
  step,
}: {
  dx: number;
  /** px/ms。左向きが負。 */
  velocity: number;
  trackWidth: number;
  step: number;
}): number {
  // 動かした量を「何日ぶんか」に直す。指を左へ動かすと先の日付へ進むので符号を反転する。
  const moved = (-dx / trackWidth) * step;
  const whole = Math.trunc(moved);
  const fraction = moved - whole;

  // 列の切れ目を越えていれば次の日まで送り、届いていなければ手前の切れ目へ戻す。
  let deltaDays = Math.abs(fraction) >= COMMIT_RATIO ? whole + Math.sign(fraction) : whole;

  // 素早く払ったときは、移動量が足りなくてもその向きへ1日は送る。
  if (velocity <= -COMMIT_VELOCITY) deltaDays = Math.max(deltaDays, 1);
  else if (velocity >= COMMIT_VELOCITY) deltaDays = Math.min(deltaDays, -1);

  // 手元にあるのは前後1期間ぶんまで。それより先へは一度に送らない。
  return Math.min(Math.max(deltaDays, -step), step);
}

type Origin = {
  x: number;
  y: number;
  time: number;
  width: number;
};

export function useDaySwipe({
  daysKey,
  step,
  enabled,
  onSwipe,
}: {
  /** 表示中の期間を表す値。これが変わったら送り先が画面に出たとみなす。 */
  daysKey: string;
  /** 表示中の期間に並んでいる日数。1日ぶんの幅を割り出すために使う。 */
  step: number;
  /** 予定のドラッグ中など、横の動きを日付の移動として扱ってはいけない間は false。 */
  enabled: boolean;
  /** 送る日数。正で先の日付へ。 */
  onSwipe: (deltaDays: number) => void;
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

  /** 日付列の切れ目まで吸着させる。deltaDays が 0 なら元の位置へ戻す。 */
  const settle = (deltaDays: number) => {
    setSnapping(true);

    if (deltaDays === 0) {
      setOffset(0);
      snapTimerRef.current = setTimeout(() => {
        snapTimerRef.current = null;
        setSnapping(false);
      }, SWIPE_SNAP_MS);
      return;
    }

    // 送り先の日付が定位置に来るまで動かしきってから、表示中の期間そのものを切り替える。
    setOffset(-deltaDays / step);
    snapTimerRef.current = setTimeout(() => {
      snapTimerRef.current = null;
      onSwipe(deltaDays);
    }, SWIPE_SNAP_MS);
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const origin = originRef.current;
    const wasHorizontal = axisRef.current === "horizontal";
    cancelGesture();

    if (!origin || !wasHorizontal) return;

    const dx = event.clientX - origin.x;

    settle(
      swipeDeltaDays({
        dx,
        velocity: dx / Math.max(event.timeStamp - origin.time, 1),
        trackWidth: origin.width,
        step,
      }),
    );
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
