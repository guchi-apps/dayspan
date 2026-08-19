// サーバー間参照用API（`/api/internal/*`）が返す形（docs/internal-api.md）。
//
// 画面用の型（types/calendar.ts）をそのまま返さない。あちらは描画の都合で持っている項目
// （readOnly・列の並び・展開した回のID）を含んでおり、呼び出し元にDaySpanの画面の事情を
// 持ち込ませることになる。ここは呼び出し元がそのまま読める形に絞って写す。
//
// このファイルは呼び出し元（guchi-apps/aide）へ写して使える形にしてある。

import type { TravelMode } from "@/types/calendar";

/** 予定。時刻は設定タイムゾーンでの HH:MM で、終日のときは null。 */
export type InternalEvent = {
  id: string;
  title: string;
  allDay: boolean;
  /** allDay なら YYYY-MM-DD、それ以外は ISO 8601 */
  start: string;
  end: string;
  /** 設定タイムゾーンでの HH:MM。終日は null。日をまたぐ予定はその日の範囲へ切り詰める */
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  description: string | null;
  calendarName: string;
  /** 繰り返し予定の1回分かどうか */
  recurring: boolean;
  url: string | null;
};

/** タスクがカレンダーに現れる枠の種類。期限は締切、予定日は片付けるつもりの日。 */
export type InternalTaskField = "due" | "planned";

export type InternalTask = {
  id: string;
  title: string;
  field: InternalTaskField;
  /** 時刻なしは YYYY-MM-DD、時刻ありは ISO 8601 */
  date: string;
  hasTime: boolean;
  /** 設定タイムゾーンでの HH:MM。時刻なしは null */
  time: string | null;
  priority: string | null;
  tags: string[];
  memo: string | null;
  url: string | null;
};

/** 期限切れの未完了タスク。要求した範囲より前に期限があるもの。 */
export type InternalOverdueTask = {
  id: string;
  title: string;
  /** 期限。時刻なしは YYYY-MM-DD、時刻ありは ISO 8601 */
  due: string;
  hasTime: boolean;
  time: string | null;
  /** 範囲の初日から見て何日過ぎているか（1以上） */
  daysOverdue: number;
  priority: string | null;
  tags: string[];
  url: string | null;
};

export type InternalReminder = {
  /** 表示上のID。毎年の項目を年ごとに展開した回は元ページのIDと異なる */
  id: string;
  title: string;
  /** 日付のみは YYYY-MM-DD、時刻ありは ISO 8601 */
  date: string;
  hasTime: boolean;
  time: string | null;
  category: string | null;
  /** 毎年の項目かどうか。プロパティ未設定で判断できないときは null */
  annual: boolean | null;
  /** garbage は外部アプリ（myroom）が書くゴミの収集日。DaySpanからは読むだけ */
  source: "reminder" | "garbage";
  memo: string | null;
  url: string | null;
};

export type InternalTravel = {
  id: string;
  /** 「自宅 → 渋谷」の形 */
  title: string;
  origin: string;
  destination: string;
  mode: TravelMode;
  /** ISO 8601。移動は必ず時刻を持つ */
  start: string;
  end: string;
  startTime: string | null;
  endTime: string | null;
  /** 所要時間がAIの見積もりかどうか（目安であることを示すために持つ） */
  estimated: boolean;
  returnLeg: boolean;
  note: string | null;
};

/** 1日ぶんの中身。並び順はカレンダー画面と同じ（終日→時刻順→同時刻はタイトル順）。 */
export type InternalScheduleDay = {
  /** YYYY-MM-DD（設定タイムゾーン） */
  date: string;
  events: InternalEvent[];
  tasks: InternalTask[];
  reminders: InternalReminder[];
  travels: InternalTravel[];
};

export type InternalScheduleResponse = {
  generatedAt: string;
  /** 日付の解釈に使ったタイムゾーン（UiSetting.timeZone、既定 Asia/Tokyo） */
  timeZone: string;
  range: { from: string; to: string };
  days: InternalScheduleDay[];
  overdueTasks: InternalOverdueTask[];
  /**
   * 連携ごとの取得失敗。片方が落ちていても取れたぶんは返すため、
   * 呼び出し元は「予定は取れなかった」と伝えられる。空配列なら全て取れている。
   */
  errors: { source: "google" | "notion"; reason: string }[];
};
