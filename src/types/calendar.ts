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
  attendees: string[];
  /** 繰り返し予定の1回分かどうか。編集時に「この回だけ変わる」ことを伝えるために持つ。 */
  recurring: boolean;
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

export type ReminderItem = {
  kind: "reminder";
  id: string;
  title: string;
  /** 対象日。日付のみは YYYY-MM-DD、時刻ありは ISO 8601。 */
  date: string;
  hasTime: boolean;
  category: string | null;
  memo: string | null;
  /** 毎年の項目かどうか。プロパティ未設定時はどちらか不明のため null。 */
  annual: boolean | null;
  url: string | null;
};

export type CalendarItem = CalendarEventItem | TaskItem | ReminderItem;

/** 予定の保存先として選べるカレンダー。 */
export type WritableCalendar = {
  calendarId: string;
  name: string;
  color: string | null;
  isCreateDefault: boolean;
};

export type CalendarLoadResult = {
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  calendars: WritableCalendar[];
  notionReady: boolean;
  /** 連携ごとの取得失敗。片方が失敗してももう片方は表示できるようにする。 */
  errors: { source: "google" | "notion"; reason: string }[];
};
