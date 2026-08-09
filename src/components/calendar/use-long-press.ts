"use client";

import { useCallback, useEffect, useRef } from "react";

// 押す・長押しの2つの意味を1つの面に持たせるためのフック。
// 月表示の日のセルは、押せば1日表示へ移り、長押しならその日へ予定を足す。
//
// 長押しを受けるのは指・ペンだけにする。マウスには「押し続ける」操作が無く、
// 少し長めのクリックを追加の操作と取り違えると、移動したいだけの人が入力欄に出くわす。

/** 長押しと判断するまでの時間。予定のドラッグ（use-grid-drag）と同じにして、面ごとの差をなくす。 */
const LONG_PRESS_MS = 400;

/** これを超えて動いたらスクロール操作とみなし、長押しを取りやめる。 */
const TOLERANCE_PX = 8;

/**
 * 押した対象を表す値ごとにイベントハンドラを作る。
 * 返ってきたハンドラを、そのまま対象の要素へ展開する。
 */
export function useLongPress<T>({
  onPress,
  onLongPress,
}: {
  onPress: (value: T) => void;
  onLongPress: (value: T) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  // 長押しが成立したかどうか。成立した指を離したときのclickを捨てるために持つ。
  const firedRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    originRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return (value: T) => ({
    onPointerDown: (event: React.PointerEvent) => {
      firedRef.current = false;
      if (event.pointerType === "mouse") return;

      originRef.current = { x: event.clientX, y: event.clientY };
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        originRef.current = null;
        firedRef.current = true;
        onLongPress(value);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: React.PointerEvent) => {
      const origin = originRef.current;
      if (!origin) return;
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > TOLERANCE_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClick: () => {
      // 長押しの後に指を離しても click は届く。そのまま通すと、予定を足した直後に
      // 1日表示へ移ってしまう。
      if (firedRef.current) {
        firedRef.current = false;
        return;
      }
      onPress(value);
    },
    onContextMenu: (event: React.MouseEvent) => {
      // Androidは長押しでコンテキストメニューを出す。こちらの操作と重なるため止める。
      if (firedRef.current) event.preventDefault();
    },
  });
}
