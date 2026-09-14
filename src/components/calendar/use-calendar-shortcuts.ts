"use client";

import { useEffect, useRef } from "react";

import type { CalendarView } from "@/lib/calendar-range";

import type { AddableKind } from "./item-dialog";

/**
 * キー→表示形式の対応。ラベル（1日・3日・月）とGoogle Calendarの慣習（m）を両方汲む。
 * `w`（週表示）は幅によって選べるかどうかが変わるため、switch側で別扱いにする。
 */
const VIEW_KEYS: Record<string, CalendarView> = {
  "1": "day1",
  "3": "day3",
  m: "month",
};

/**
 * 週表示（`day7`）のセグメンテッドボタンが出る幅（Tailwindの `md` ブレークポイント）。
 * それより狭いウィンドウでは押しても選べない表示形式になるため、`w` キーを無視する
 * （issue #635 計画レビューG1の指摘）。
 */
const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

export type CalendarShortcutActions = {
  onGoToday: () => void;
  onMove: (direction: 1 | -1) => void;
  onSwitchView: (view: CalendarView) => void;
  onRefresh: () => void;
  onAdd: (available: Record<AddableKind, boolean>) => void;
  onOpenHelp: () => void;
};

type CalendarShortcutsArgs = {
  offline: boolean;
  /** 右下の「＋」と同じ、追加できる種類。1つも無ければ `c` は何もしない。 */
  available: Record<AddableKind, boolean>;
  actions: CalendarShortcutActions;
};

/**
 * カレンダー画面（PC）のキーボードショートカット（docs/spec.md §41、issue #635）。
 *
 * リスナーは初回マウント時に1回だけ登録する。引数はrefで常に最新を読むため、
 * Shell/Bodyの再レンダリングのたびにaddEventListener/removeEventListenerを
 * 繰り返さない（ドラッグ追従をReactのstateにしないのと同じ理由）。
 */
export function useCalendarShortcuts(args: CalendarShortcutsArgs) {
  const argsRef = useRef(args);

  // レンダー中ではなくレンダー後にrefへ書く（react-hooks/refs）。依存配列を省き、毎回のレンダーの
  // 後に必ず最新へ同期する。
  useEffect(() => {
    argsRef.current = args;
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const { offline, available, actions } = argsRef.current;

      if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
      if (isTextInput(event.target)) return;
      // ドロワー・下部ナビのシート・入力/詳細/確認ダイアログなど、アプリ内のダイアログは
      // すべて同じ `Dialog`（Radix）を通るため、role属性1つでまとめて判定できる。
      // 開閉状態をShell/Bodyへ列挙して持たせると、新しいダイアログが増えるたびに漏れが生まれる
      // （issue #635 計画レビューG1の指摘）。
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;

      if (event.key === "?") {
        event.preventDefault();
        actions.onOpenHelp();
        return;
      }

      switch (event.key) {
        case "t":
          actions.onGoToday();
          return;
        case "ArrowLeft":
          actions.onMove(-1);
          return;
        case "ArrowRight":
          actions.onMove(1);
          return;
        case "r":
          if (!offline) actions.onRefresh();
          return;
        case "c":
          if (!offline && (available.event || available.task || available.travel)) {
            actions.onAdd(available);
          }
          return;
        case "w":
          // 週表示のボタン自体がこの幅では出ない（`desktopOnly`）。選べない表示形式に
          // 切り替わってしまわないよう、押した時点の幅で判定する。
          if (window.matchMedia(DESKTOP_MEDIA_QUERY).matches) actions.onSwitchView("day7");
          return;
        default:
          break;
      }

      const view = VIEW_KEYS[event.key];
      if (view) actions.onSwitchView(view);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}

/** 文字入力欄にフォーカスがあるとき。ここでは発火させず、通常の入力を優先する。 */
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
