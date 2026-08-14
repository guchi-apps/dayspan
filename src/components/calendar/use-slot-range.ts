"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { MINUTES_PER_DAY } from "./item-layout";

// 時間グリッドの空いているところを縦にドラッグして、予定の時間帯を先に決める操作。
//
// 押しただけなら既定の長さ（1時間）の簡易入力を開くが、そのまま下（上）へ引くと
// 引いた範囲がそのまま開始・終了時刻になる。押した位置で開始だけを決めて
// 終了を入力欄で直す、という往復を無くすため。
//
// 受けるのはマウス・ペンのみ。指では同じ面の上で縦スクロールが起きるため、
// 空きをなぞる操作と区別できない（スマートフォンでは押して簡易入力を開く従来のままにする）。

/** 15分刻みに丸める。予定のドラッグ（use-grid-drag.ts）と刻みをそろえる。 */
const SNAP_MINUTES = 15;

/** クリックと範囲選択を取り違えないための最小移動量。use-grid-drag.ts と同じ値。 */
const MOUSE_THRESHOLD_PX = 3;

export type SlotRangePreview = {
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
};

export type SlotRangeCommit = {
  dateKey: string;
  startMinutes: number;
  endMinutes: number;
};

type Origin = {
  dayIndex: number;
  /** 押した位置の時刻（15分刻みに切り下げ）。ここを軸に、上下どちらへ引いても範囲になる。 */
  anchorMinutes: number;
  /** 時刻を読み取る元の要素。ドラッグ中にスクロールされても、その都度測り直す。 */
  column: HTMLElement;
  pointerX: number;
  pointerY: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 押した位置（anchor）と今いる位置（edge）から時間帯を決める。
 *
 * 上へ引いた場合も同じ幅の範囲として扱う。下向きだけを認めると、
 * 目的の終了時刻に合わせてから開始を決める、という引き方ができないため。
 * 動かした先が押した位置と同じ枠に留まっている間は、最小の1枠（15分）にする。
 */
function slotRange(anchorMinutes: number, edgeMinutes: number) {
  if (edgeMinutes > anchorMinutes) return { startMinutes: anchorMinutes, endMinutes: edgeMinutes };
  if (edgeMinutes < anchorMinutes) return { startMinutes: edgeMinutes, endMinutes: anchorMinutes };
  return { startMinutes: anchorMinutes, endMinutes: anchorMinutes + SNAP_MINUTES };
}

export function useSlotRange({
  days,
  onCommit,
}: {
  days: string[];
  onCommit: (commit: SlotRangeCommit) => void;
}) {
  const originRef = useRef<Origin | null>(null);
  // 範囲を引いたあとに残るclickで、押した位置ぶんの簡易入力が重ねて開かないようにする。
  const movedRef = useRef(false);

  const [preview, setPreview] = useState<SlotRangePreview | null>(null);

  /** この列の中での縦位置を、0:00からの分数へ直す（丸めない）。 */
  const minutesFromPointer = useCallback((column: HTMLElement, clientY: number) => {
    const rect = column.getBoundingClientRect();
    // 1時間あたりの高さはピンチで変わる（use-time-zoom.ts）。定数からではなく実測から求める。
    const height = Math.max(rect.height, 1);
    return clamp(((clientY - rect.top) / height) * MINUTES_PER_DAY, 0, MINUTES_PER_DAY);
  }, []);

  const startSelect = useCallback(
    (event: React.PointerEvent, dayIndex: number) => {
      // 指はスクロールと区別できないため受けない。押して簡易入力を開く動作はそのまま残る。
      if (event.pointerType === "touch") return;
      // 押しながらの操作なので、副ボタン（右クリック・戻る等）では始めない。
      if (event.button !== 0) return;

      const column = event.currentTarget as HTMLElement;
      // 軸は切り下げる。四捨五入だと、枠の後ろ半分を押したときに押した位置より後ろから
      // 始まる範囲になり、押したところが範囲の外に出てしまう。
      const anchorMinutes = clamp(
        Math.floor(minutesFromPointer(column, event.clientY) / SNAP_MINUTES) * SNAP_MINUTES,
        0,
        MINUTES_PER_DAY - SNAP_MINUTES,
      );

      movedRef.current = false;
      originRef.current = {
        dayIndex,
        anchorMinutes,
        column,
        pointerX: event.clientX,
        pointerY: event.clientY,
      };

      column.setPointerCapture(event.pointerId);
      // 枠を出すのは実際に動かしてから。押した時点で出すと、ただ押しただけのときに
      // 最小の枠が一瞬光り、そのあと開く簡易入力（既定は1時間）と食い違って見える。
    },
    [minutesFromPointer],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const origin = originRef.current;
      if (!origin) return;

      const distance = Math.hypot(event.clientX - origin.pointerX, event.clientY - origin.pointerY);
      if (!movedRef.current && distance < MOUSE_THRESHOLD_PX) return;

      movedRef.current = true;

      // 動かしている側の端は四捨五入する。切り下げると、次の枠へ入りきるまで
      // 引いた手応えが返らず、指した時刻より短い範囲が出続けてしまう。
      const edgeMinutes =
        Math.round(minutesFromPointer(origin.column, event.clientY) / SNAP_MINUTES) * SNAP_MINUTES;

      // 日をまたぐ予定はこの操作では作れないため、列は押した日から動かさない。
      // 横へ動かした先の列で作ると、斜めに引いただけで別の日の予定になってしまう。
      setPreview({
        dayIndex: origin.dayIndex,
        ...slotRange(origin.anchorMinutes, edgeMinutes),
      });
    },
    [minutesFromPointer],
  );

  const handlePointerUp = useCallback(() => {
    const origin = originRef.current;
    const current = preview;

    originRef.current = null;
    setPreview(null);

    // 動かしていない＝ただのクリック。押した位置ぶんの簡易入力を開く従来の動作に任せる。
    if (!origin || !current || !movedRef.current) return;

    onCommit({
      dateKey: days[current.dayIndex],
      startMinutes: current.startMinutes,
      endMinutes: current.endMinutes,
    });
  }, [days, onCommit, preview]);

  /**
   * 確定させずに取りやめる。ピンチのように、引き始めたあとで別の操作だと分かったときに使う。
   * 指・カーソルが離れたわけではないため、この時点の範囲で入力画面を開いてはいけない。
   */
  const cancelSelect = useCallback(() => {
    originRef.current = null;
    movedRef.current = false;
    setPreview(null);
  }, []);

  /** 範囲を引いた直後のclickかどうか。trueなら簡易入力を開き直さない。 */
  const consumeSelectClick = useCallback(() => {
    if (!movedRef.current) return false;
    movedRef.current = false;
    return true;
  }, []);

  /**
   * 次の操作が始まったので「動かした」印を落とす。
   *
   * 引いた範囲の上で離した場合など、そのあとclickが来ないことがある。印が残ったままだと、
   * 次に予定を押したときのclickがその印に食われ、内容の画面が開かなくなる。
   */
  const resetSelectClick = useCallback(() => {
    movedRef.current = false;
  }, []);

  // 引いている最中にEscで取りやめられるようにする。カーソルを離せば必ず入力画面が開くため、
  // 押し間違いに気付いた時点で抜ける手立てが無いとやり直しになる。
  useEffect(() => {
    if (!preview) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelSelect();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [preview, cancelSelect]);

  return {
    preview,
    selecting: preview !== null,
    startSelect,
    cancelSelect,
    handlePointerMove,
    handlePointerUp,
    consumeSelectClick,
    resetSelectClick,
  };
}
