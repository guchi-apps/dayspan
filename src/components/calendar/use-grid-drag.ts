"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CalendarEventItem, TaskItem } from "@/types/calendar";

import { GRID_HEIGHT, MINUTES_PER_DAY } from "./item-layout";

// 15分刻みに丸める。1分刻みだと指やマウスの微小な揺れがそのまま時刻になり、扱いにくい。
const SNAP_MINUTES = 15;
// スマートフォンではスクロールとの誤操作を避けるため、長押しを起点にする（docs/spec.md §8）。
const LONG_PRESS_MS = 400;
const LONG_PRESS_TOLERANCE_PX = 8;
// マウスでは、クリックとドラッグを取り違えないだけの最小移動量を求める。
const MOUSE_THRESHOLD_PX = 3;

export type DragMode = "move" | "resize-start" | "resize-end";

export type DragTarget =
  | { kind: "event"; item: CalendarEventItem; mode: DragMode }
  | { kind: "task"; item: TaskItem };

export type DragPreview = {
  id: string;
  dayIndex: number;
  startMinutes: number;
  /** タスクは時間幅を持たないため startMinutes と同じ値になる。 */
  endMinutes: number;
};

export type DragCommit = {
  target: DragTarget;
  dayKey: string;
  startMinutes: number;
  endMinutes: number;
};

type Origin = {
  target: DragTarget;
  dayIndex: number;
  startMinutes: number;
  endMinutes: number;
  pointerX: number;
  pointerY: number;
  pointerType: string;
};

function snap(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function useGridDrag({
  days,
  onCommit,
}: {
  days: string[];
  onCommit: (commit: DragCommit) => void;
}) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const originRef = useRef<Origin | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ドラッグ直後のclickで編集ダイアログが開いてしまうのを防ぐ。
  const movedRef = useRef(false);

  const [preview, setPreview] = useState<DragPreview | null>(null);
  const [active, setActive] = useState(false);

  // ドラッグ中はブラウザのスクロールを止める。touch-actionの変更はジェスチャー開始後には
  // 効かないため、非パッシブのtouchmoveでpreventDefaultする。
  useEffect(() => {
    if (!active) return;

    const block = (event: TouchEvent) => event.preventDefault();
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, [active]);

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const positionFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const grid = gridRef.current;
      if (!grid) return null;

      const rect = grid.getBoundingClientRect();
      // 左端の時刻目盛り分を除いた範囲を、日付列で等分する。
      const gutter = grid.dataset.gutterWidth ? Number(grid.dataset.gutterWidth) : 48;
      const columnWidth = (rect.width - gutter) / days.length;

      const dayIndex = clamp(
        Math.floor((clientX - rect.left - gutter) / columnWidth),
        0,
        days.length - 1,
      );
      const minutes = ((clientY - rect.top) / GRID_HEIGHT) * MINUTES_PER_DAY;

      return { dayIndex, minutes };
    },
    [days.length],
  );

  const updatePreview = useCallback(
    (clientX: number, clientY: number) => {
      const origin = originRef.current;
      const position = positionFromPointer(clientX, clientY);
      if (!origin || !position) return;

      const deltaMinutes = snap(
        (((clientY - origin.pointerY) / GRID_HEIGHT) * MINUTES_PER_DAY),
      );
      const duration = origin.endMinutes - origin.startMinutes;

      let startMinutes = origin.startMinutes;
      let endMinutes = origin.endMinutes;

      if (origin.target.kind === "task") {
        startMinutes = clamp(
          snap(origin.startMinutes + deltaMinutes),
          0,
          MINUTES_PER_DAY - SNAP_MINUTES,
        );
        endMinutes = startMinutes;
      } else if (origin.target.mode === "move") {
        startMinutes = clamp(
          snap(origin.startMinutes + deltaMinutes),
          0,
          MINUTES_PER_DAY - duration,
        );
        endMinutes = startMinutes + duration;
      } else if (origin.target.mode === "resize-start") {
        startMinutes = clamp(
          snap(origin.startMinutes + deltaMinutes),
          0,
          origin.endMinutes - SNAP_MINUTES,
        );
      } else {
        endMinutes = clamp(
          snap(origin.endMinutes + deltaMinutes),
          origin.startMinutes + SNAP_MINUTES,
          MINUTES_PER_DAY,
        );
      }

      // 日付の移動は「掴んだまま横へ動かす」操作なので、リサイズ中は列を変えない。
      const dayIndex =
        origin.target.kind === "event" && origin.target.mode !== "move"
          ? origin.dayIndex
          : position.dayIndex;

      setPreview({
        id: origin.target.item.id,
        dayIndex,
        startMinutes,
        endMinutes,
      });
    },
    [positionFromPointer],
  );

  const finish = useCallback(() => {
    const origin = originRef.current;
    const current = preview;

    cancelLongPress();
    originRef.current = null;
    setActive(false);
    setPreview(null);

    if (!origin || !current) return;

    const unchanged =
      current.dayIndex === origin.dayIndex &&
      current.startMinutes === origin.startMinutes &&
      current.endMinutes === origin.endMinutes;

    if (unchanged) return;

    onCommit({
      target: origin.target,
      dayKey: days[current.dayIndex],
      startMinutes: current.startMinutes,
      endMinutes: current.endMinutes,
    });
  }, [days, onCommit, preview]);

  const startDrag = useCallback(
    (
      event: React.PointerEvent,
      target: DragTarget,
      geometry: { dayIndex: number; startMinutes: number; endMinutes: number },
    ) => {
      movedRef.current = false;

      originRef.current = {
        target,
        ...geometry,
        pointerX: event.clientX,
        pointerY: event.clientY,
        pointerType: event.pointerType,
      };

      event.currentTarget.setPointerCapture(event.pointerId);

      if (event.pointerType === "touch") {
        // 指を置いた直後は、まだスクロールかドラッグか分からない。一定時間動かなければドラッグ。
        longPressTimerRef.current = setTimeout(() => {
          longPressTimerRef.current = null;
          setActive(true);
          setPreview({ id: target.item.id, ...geometry });
        }, LONG_PRESS_MS);
      } else {
        setActive(true);
        setPreview({ id: target.item.id, ...geometry });
      }
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      const origin = originRef.current;
      if (!origin) return;

      const distance = Math.hypot(
        event.clientX - origin.pointerX,
        event.clientY - origin.pointerY,
      );

      // 長押し待ちの間に動いたらスクロール操作とみなし、ドラッグを取りやめる。
      if (longPressTimerRef.current !== null) {
        if (distance > LONG_PRESS_TOLERANCE_PX) {
          cancelLongPress();
          originRef.current = null;
        }
        return;
      }

      if (!active) return;
      if (origin.pointerType !== "touch" && distance < MOUSE_THRESHOLD_PX) return;

      movedRef.current = true;
      updatePreview(event.clientX, event.clientY);
    },
    [active, updatePreview],
  );

  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      // 長押しが成立する前に離した＝ただのタップ。編集を開く動作に任せる。
      cancelLongPress();
      originRef.current = null;
      setActive(false);
      return;
    }
    finish();
  }, [finish]);

  /** ドラッグ直後のclickかどうか。trueなら編集ダイアログを開かない。 */
  const consumeDragClick = useCallback(() => {
    if (!movedRef.current) return false;
    movedRef.current = false;
    return true;
  }, []);

  useEffect(() => cancelLongPress, []);

  return {
    gridRef,
    preview,
    dragging: active,
    startDrag,
    handlePointerMove,
    handlePointerUp,
    consumeDragClick,
  };
}
