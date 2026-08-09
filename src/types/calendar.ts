// カレンダー画面が扱う表示用の型。Google Calendar / Notion のレスポンス形をそのままUIへ
// 持ち込まず、ここで1つの形に正規化する（docs/spec.md §22）。

/** 終日・日付のみの項目は plain（YYYY-MM-DD）、時刻ありは ISO 8601 文字列で持つ。 */
export type CalendarEventItem = {
  kind: "event";
  id: string;
  calendarId: string;
  calendarName: string;
  title: string;
  allDay: boolean;
  /** allDay のときは YYYY-MM-DD、それ以外は ISO 8601 */
  start: string;
  /** allDay のときは YYYY-MM-DD（終了日を含む）、それ以外は ISO 8601 */
  end: string;
  location: string | null;
  description: string | null;
  color: string | null;
  url: string | null;
};

export type TaskPriority = string | null;

export type TaskItem = {
  kind: "task";
  id: string;
  title: string;
  /** 期限。時刻なしは YYYY-MM-DD、時刻ありは ISO 8601。未設定は null */
  due: string | null;
  hasTime: boolean;
  done: boolean;
  priority: TaskPriority;
  tags: string[];
  memo: string | null;
  recurrence: string | null;
  url: string | null;
};

export type CalendarItem = CalendarEventItem | TaskItem;

export type CalendarLoadResult = {
  events: CalendarEventItem[];
  tasks: TaskItem[];
  /** 連携ごとの取得失敗。片方が失敗してももう片方は表示できるようにする。 */
  errors: { source: "google" | "notion"; reason: string }[];
};
