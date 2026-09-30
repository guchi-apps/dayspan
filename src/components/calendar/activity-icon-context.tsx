"use client";

import { createContext, useContext } from "react";

/** 活動記録の項目名 → アイコンキー（issue #907）。未設定の項目は含まれず、名前の既定に落ちる。 */
const ActivityIconContext = createContext<Readonly<Record<string, string>>>({});

export const ActivityIconProvider = ActivityIconContext.Provider;

export function useActivityIcons() {
  return useContext(ActivityIconContext);
}
