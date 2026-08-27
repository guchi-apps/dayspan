"use client";

import { useCallback, useSyncExternalStore } from "react";

import { SHOPPING_SORTS, type ShoppingSort } from "@/types/shopping";

// 買い物画面の見え方（並び順・購入済みの表示）を端末に覚えさせる。
//
// タスク画面（use-task-view-prefs.ts）と同じ形・同じ理由。カレンダーのCookie方式とは分ける。
// あちらはサーバー側で取得範囲を組み立てる前に要る値だが、こちらは描いたあとで足りる。
//
// 選んでいるカテゴリは覚えない。開く理由は「いま何が残っているか」を見ることで、
// 前に見ていたカテゴリで開くと、他のカテゴリに残っているものが最初の画面から抜ける。

type Prefs = {
  sort: ShoppingSort;
  /** 購入済みを出しているか。件数が増え続けるため、既定は隠す。 */
  showBought: boolean;
};

const DEFAULT_PREFS: Prefs = { sort: "added", showBought: false };

const STORAGE_KEYS = {
  sort: "dayspan:shopping:sort",
  showBought: "dayspan:shopping:show-bought",
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
  const sort = readItem(STORAGE_KEYS.sort);
  const showBought = readItem(STORAGE_KEYS.showBought);

  return {
    sort: SHOPPING_SORTS.includes(sort as ShoppingSort)
      ? (sort as ShoppingSort)
      : DEFAULT_PREFS.sort,
    showBought: showBought === "1",
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
    window.localStorage.setItem(STORAGE_KEYS.sort, current.sort);
    window.localStorage.setItem(STORAGE_KEYS.showBought, current.showBought ? "1" : "0");
  } catch {
    // 保存できなくても、その画面を開いている間の見え方は保てる。
  }

  for (const listener of listeners) listener();
}

export type ShoppingViewPrefs = Prefs & {
  setSort: (sort: ShoppingSort) => void;
  setShowBought: (showBought: boolean) => void;
};

export function useShoppingViewPrefs(): ShoppingViewPrefs {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setSort = useCallback((sort: ShoppingSort) => update({ sort }), []);
  const setShowBought = useCallback((showBought: boolean) => update({ showBought }), []);

  return { ...prefs, setSort, setShowBought };
}
