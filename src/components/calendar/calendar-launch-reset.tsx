"use client";

import { useEffect } from "react";

import { resetCalendarMemoryOnLaunch } from "@/lib/calendar-view-memory";

/**
 * アプリを起動し直したら、カレンダーの前回の状態（issue #279）を捨てる（issue #353）。
 *
 * 判定と破棄そのものは resetCalendarMemoryOnLaunch() が持つ。ここはそれを最初の描画で
 * 1回呼ぶだけで、描画するものは無い。
 *
 * どの画面から起動してもカレンダーを開くより前に済ませる必要があるため、ルートレイアウトに置く。
 */
export function CalendarLaunchReset() {
  useEffect(() => {
    resetCalendarMemoryOnLaunch();
  }, []);

  return null;
}
