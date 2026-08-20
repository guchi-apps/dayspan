"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { TaskSort } from "@/services/notion/task-buckets";

// タスク画面の見え方（分類の軸・並び順・完了の開閉）を端末に覚えさせる（issue #286）。
//
// カレンダー画面のCookie方式（lib/calendar-view-memory.ts）とは分ける。あちらはサーバー側で
// 取得範囲を組み立てる前に要る値だが、こちらは描いたあとで足りる。
//
// localStorage という React の外にある状態として扱い、購読して読む
// （components/calendar/use-time-zoom.ts と同じ形）。サーバー側には無い値なので、初回の描画では
// 既定値を返してハイドレーションを一致させる。

/** タスクを何でまとめるか。tag はタグごとの見出しに切り替える。 */
export type TaskGroupBy = "due" | "tag";

type Prefs = {
  groupBy: TaskGroupBy;
  sort: TaskSort;
  /** 完了の折りたたみを開いているか。完了は履歴で件数が増え続けるため、既定は閉じる。 */
  doneOpen: boolean;
};

const DEFAULT_PREFS: Prefs = { groupBy: "due", sort: "due", doneOpen: false };

const STORAGE_KEYS = {
  groupBy: "dayspan:tasks:group-by",
  sort: "dayspan:tasks:sort",
  doneOpen: "dayspan:tasks:done-open",
} as const;

let current: Prefs | null = null;
const listeners = new Set<() => void>();

function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // プライベートモードなど読み書きできない環境では、既定の見え方のまま使う。
    return null;
  }
}

function readStored(): Prefs {
  const groupBy = readItem(STORAGE_KEYS.groupBy);
  const sort = readItem(STORAGE_KEYS.sort);
  const doneOpen = readItem(STORAGE_KEYS.doneOpen);

  return {
    groupBy: groupBy === "tag" ? "tag" : DEFAULT_PREFS.groupBy,
    sort: sort === "priority" ? "priority" : DEFAULT_PREFS.sort,
    doneOpen: doneOpen === "1",
  };
}

function getSnapshot(): Prefs {
  if (current === null) current = readStored();
  return current;
}

function getServerSnapshot(): Prefs {
  return DEFAULT_PREFS;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(next: Partial<Prefs>): void {
  current = { ...getSnapshot(), ...next };

  try {
    window.localStorage.setItem(STORAGE_KEYS.groupBy, current.groupBy);
    window.localStorage.setItem(STORAGE_KEYS.sort, current.sort);
    window.localStorage.setItem(STORAGE_KEYS.doneOpen, current.doneOpen ? "1" : "0");
  } catch {
    // 保存できなくても、その画面を開いている間の見え方は保てる。
  }

  for (const listener of listeners) listener();
}

export type TaskViewPrefs = Prefs & {
  setGroupBy: (groupBy: TaskGroupBy) => void;
  setSort: (sort: TaskSort) => void;
  setDoneOpen: (doneOpen: boolean) => void;
};

export function useTaskViewPrefs(): TaskViewPrefs {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setGroupBy = useCallback((groupBy: TaskGroupBy) => update({ groupBy }), []);
  const setSort = useCallback((sort: TaskSort) => update({ sort }), []);
  const setDoneOpen = useCallback((doneOpen: boolean) => update({ doneOpen }), []);

  return { ...prefs, setGroupBy, setSort, setDoneOpen };
}
