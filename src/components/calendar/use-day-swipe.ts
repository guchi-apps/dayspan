"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

// 日表示の左右スワイプ。前後の期間を左右に並べておき、指が動いたぶんだけ横へずらす。
// 送ると決まったら残りをアニメーションで詰め、期間そのものの切り替えは呼び出し側に任せる。
//
// 動かす単位は期間ではなく1日。3日表示で3日ずつしか動けないと、
// 「今日を真ん中に置く」「明日から3日を見る」といった見方に切り替えられないため。
// 前後の期間は日付列の幅がそろって並んでいるので、1列ぶんずらせば1日ぶん動く。
//
// 縦スクロール・予定のドラッグと同じ面の上で起きる操作なので、どちらに動かしたのかが
// はっきりするまでは何もしない。取り違えると、スクロールのつもりで日付が変わってしまう。
//
// 指に追従させる位置はReactのstateではなく、登録された要素へ直接書き込む（registerTrack）。
// 動かしている帯は3期間ぶんの幅と24時間ぶんの高さを持つため、指の動きごとに描き直すと
// そのぶんの再描画が毎フレーム挟まり、指に対して遅れて動く。

/**
 * 横に振ったと判断する最小移動量。これ未満は縦スクロールやタップの揺れと区別できない。
 *
 * ブラウザは `touch-action: pan-y` のもと、8px前後動いた時点で縦へ流すかどうかを自分で決める。
 * それより後にこちらが判定すると、「ブラウザは横だと決めた（＝縦に流さない）のに、こちらは
 * 縦だと決めて何もしない」指ができ、縦にも横にも動かないまま終わる。先に決めるため小さくする。
 */
const AXIS_LOCK_PX = 6;

/**
 * 次の日へ送るのに必要な移動量（日付列1つぶんの幅に対する割合）。
 *
 * 半分近くまで動かさないと送れないと、指を軽く振っただけでは前の位置へ戻ってしまう。
 * 送る向きが読み取れる程度に動かしたら送る。
 */
const COMMIT_RATIO = 0.2;

/** 大きく動かさなくても送れるようにするための速度（px/ms）。素早く払う操作を拾う。 */
const COMMIT_VELOCITY = 0.2;

/**
 * 指を離す速さを測る時間の幅（ms）。
 *
 * 触れてからの平均で測ると、ゆっくり動かしてから最後に払った操作の速さが薄まり、
 * 払っても送られない。直近だけを見て、離した瞬間の速さで判断する。
 */
const VELOCITY_WINDOW_MS = 100;

/** 指を離してから隣の期間へ収まるまでの時間。M3の標準的な長さに合わせる。 */
export const SWIPE_SNAP_MS = 220;

/** 収まるときの緩急。M3のemphasized decelerateに相当し、指を離したあとが自然に減速する。 */
export const SWIPE_SNAP_EASING = "cubic-bezier(0.05, 0.7, 0.1, 1)";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 位置の書き方。指に追従している間・吸着している間・止まっている間で扱いが違う。 */
type PaintMode = "drag" | "snap" | "idle";

export type DaySwipe = {
  /** 指の操作を受け取る要素。表示中の期間の全体を覆う。 */
  rootRef: React.RefObject<HTMLDivElement | null>;
  /** 1期間ぶんの幅を測る要素。移動量を「何期間ぶんか」に直すために使う。 */
  trackRef: React.RefObject<HTMLDivElement | null>;
  /**
   * 左右へずらす帯を登録する。ヘッダー・終日・時間グリッドの3つが同じ位置で動く。
   * 位置はここへ直接書き込むため、指の動きでReactの描き直しは起きない。
   */
  registerTrack: React.RefCallback<HTMLDivElement>;
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
  width: number;
};

/** 離す瞬間の速さを求めるための、指の位置の控え。 */
type Sample = {
  x: number;
  time: number;
};

/** 日付キー（YYYY-MM-DD）の差を日数で返す。読めない値なら 0。 */
function dayDiff(fromKey: string, toKey: string): number {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;

  return Math.round((to - from) / MS_PER_DAY);
}

/** 帯を横へずらす。位置は1期間ぶんを1とした割合。 */
function paintTrack(node: HTMLElement, offset: number, mode: PaintMode): void {
  node.style.transition = mode === "snap" ? `transform ${SWIPE_SNAP_MS}ms ${SWIPE_SNAP_EASING}` : "";
  node.style.transform = `translateX(${offset * 100}%)`;
  // 動いている間だけ合成レイヤーへ載せる。常に立てると、3期間ぶんの幅と24時間ぶんの高さを持つ
  // 面を触っていない間も抱え続けることになる。
  node.style.willChange = mode === "idle" ? "" : "transform";
}

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
  const samplesRef = useRef<Sample[]>([]);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);

  const tracksRef = useRef<Set<HTMLElement>>(new Set());

  /** いま画面に出ている位置と、その書き方。あとから登録された帯を同じ位置へ合わせるのに使う。 */
  const offsetRef = useRef(0);
  const modeRef = useRef<PaintMode>("idle");

  /** 指が触れているぶんのずれ（1期間ぶんを1とした割合）。 */
  const dragRef = useRef(0);

  /**
   * 送ると決めたが、まだ画面に反映されていない日数。
   *
   * 送り先の期間が出るまで表示をその位置へ寄せておく。先に戻すと、隣の期間が出るまでの
   * 一瞬だけ元の期間へ跳ね返って見える。吸着中に次の指が来たときは、寄せたまま続きを受ける。
   */
  const pendingDaysRef = useRef(0);

  /** 吸着し終えたときに呼ぶ送り日数。途中で指が置かれたら、その場で確定させる。 */
  const snapDeltaRef = useRef(0);

  /** 直前に画面へ出ていた期間の先頭日と日数。何日ぶん進んだかを測るために持つ。 */
  const shownKeyRef = useRef(daysKey);
  const shownStepRef = useRef(step);

  const paint = useCallback(
    (mode: PaintMode) => {
      const offset = Math.min(Math.max(-pendingDaysRef.current / step + dragRef.current, -1), 1);

      offsetRef.current = offset;
      modeRef.current = mode;
      for (const node of tracksRef.current) paintTrack(node, offset, mode);
    },
    [step],
  );

  const registerTrack = useCallback<React.RefCallback<HTMLDivElement>>((node) => {
    // 外れるときは後片付けの関数のほうが呼ばれるため、ここへ null は来ない。
    if (node === null) return;

    const tracks = tracksRef.current;
    tracks.add(node);
    // 途中で現れた帯（表示形式の切り替えなど）も、いまの位置へ合わせてから並べる。
    paintTrack(node, offsetRef.current, modeRef.current);

    return () => {
      tracks.delete(node);
    };
  }, []);

  const cancelFrame = () => {
    if (frameRef.current === null) return;

    cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  };

  /** 指の動きは1フレームに1回だけ反映する。指は1フレームの間に何度も動く。 */
  const scheduleDrag = () => {
    if (frameRef.current !== null) return;

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      paint("drag");
    });
  };

  // 送り先の期間が画面に出た。進んだぶんだけ寄せを戻す。中身が同じだけずれるので、
  // 画面上の位置は動かない。前へ・次へ・今日のように、こちらが送ったのではない変化では
  // 寄せを消費しない（送った向きと量に一致するぶんだけ戻す）。
  useLayoutEffect(() => {
    const previous = shownKeyRef.current;
    const previousStep = shownStepRef.current;
    if (previous === daysKey && previousStep === step) return;

    shownKeyRef.current = daysKey;
    shownStepRef.current = step;

    if (previousStep !== step) {
      // 表示形式そのものが変わった。1日ぶんの幅も列の並びも変わるため、寄せは持ち越さない。
      pendingDaysRef.current = 0;
    } else {
      const moved = dayDiff(previous, daysKey);
      const pending = pendingDaysRef.current;
      const consumed =
        Math.sign(moved) === Math.sign(pending)
          ? Math.sign(pending) * Math.min(Math.abs(moved), Math.abs(pending))
          : 0;

      pendingDaysRef.current = pending - consumed;
    }

    paint(modeRef.current === "drag" ? "drag" : "idle");
  }, [daysKey, step, paint]);

  useEffect(
    () => () => {
      if (snapTimerRef.current !== null) clearTimeout(snapTimerRef.current);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const cancelGesture = () => {
    originRef.current = null;
    axisRef.current = "undecided";
    samplesRef.current = [];
  };

  /** 直近の指の位置を控える。窓から外れた点は、速さの基準になる1つだけ残して捨てる。 */
  const recordSample = (x: number, time: number) => {
    const samples = samplesRef.current;
    samples.push({ x, time });
    while (samples.length > 2 && time - samples[1].time >= VELOCITY_WINDOW_MS) samples.shift();
  };

  /** 直近の横向きの速さ（px/ms、左が負）。 */
  const recentVelocity = (x: number, time: number) => {
    const base = samplesRef.current[0];
    if (!base) return 0;

    const elapsed = time - base.time;
    return elapsed > 0 ? (x - base.x) / elapsed : 0;
  };

  /**
   * 吸着の途中で次の操作が来たとき。行き先はもう決まっているので、その場で終点へ置いて確定させる。
   * 待たせると、送り続けたいときに1回おきにスワイプが空振りする。
   */
  const flushSnap = () => {
    if (snapTimerRef.current === null) return;

    clearTimeout(snapTimerRef.current);
    snapTimerRef.current = null;

    const deltaDays = snapDeltaRef.current;
    snapDeltaRef.current = 0;

    // 寄せる先（pendingDaysRef）は吸着を始めた時点で入れてある。トランジションだけ切る。
    paint("idle");
    if (deltaDays !== 0) onSwipe(deltaDays);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    // 指以外は対象外。マウスの横移動は予定のドラッグで使っており、日付の移動は前へ・次へで行う。
    if (event.pointerType !== "touch") return;

    flushSnap();

    originRef.current = {
      x: event.clientX,
      y: event.clientY,
      width: Math.max(trackRef.current?.clientWidth ?? 0, 1),
    };
    axisRef.current = "undecided";
    samplesRef.current = [{ x: event.clientX, time: event.timeStamp }];
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const origin = originRef.current;
    if (!origin) return;

    if (!enabled) {
      // 予定のドラッグが成立した。この指の動きは予定のものなので日付は動かさない。
      cancelGesture();
      cancelFrame();
      dragRef.current = 0;
      paint("idle");
      return;
    }

    recordSample(event.clientX, event.timeStamp);

    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;

    if (axisRef.current === "undecided") {
      // 縦のほうが大きければスクロール。以降この指では日付を送らない。
      if (Math.abs(dy) >= AXIS_LOCK_PX && Math.abs(dy) >= Math.abs(dx)) {
        cancelGesture();
        return;
      }

      if (Math.abs(dx) < AXIS_LOCK_PX || Math.abs(dx) <= Math.abs(dy)) return;

      axisRef.current = "horizontal";
      // 判定に使ったぶんを起点から差し引く。そのままだと表示が指より先に飛ぶ。
      origin.x += Math.sign(dx) * AXIS_LOCK_PX;
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    dragRef.current = (event.clientX - origin.x) / origin.width;
    scheduleDrag();
  };

  /** 日付列の切れ目まで吸着させる。deltaDays が 0 なら元の位置へ戻す。 */
  const settle = (deltaDays: number) => {
    cancelFrame();
    dragRef.current = 0;

    // 送り先の日付が定位置に来るまで動かしきってから、表示中の期間そのものを切り替える。
    pendingDaysRef.current += deltaDays;
    snapDeltaRef.current = deltaDays;
    paint("snap");

    snapTimerRef.current = setTimeout(() => {
      snapTimerRef.current = null;
      snapDeltaRef.current = 0;
      paint("idle");
      if (deltaDays !== 0) onSwipe(deltaDays);
    }, SWIPE_SNAP_MS);
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const origin = originRef.current;
    const wasHorizontal = axisRef.current === "horizontal";
    const velocity = recentVelocity(event.clientX, event.timeStamp);
    cancelGesture();

    if (!origin || !wasHorizontal) return;

    settle(
      swipeDeltaDays({
        dx: event.clientX - origin.x,
        velocity,
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
    rootRef,
    trackRef,
    registerTrack,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
  };
}
