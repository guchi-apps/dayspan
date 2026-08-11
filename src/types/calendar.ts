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
  /**
   * 予定日。期限（締切）とは別に、その辺りの日に片付けるつもりだという見込みを表す。
   * 時刻なしは YYYY-MM-DD、時刻ありは ISO 8601。未設定は null。
   */
  planned: string | null;
  plannedHasTime: boolean;
  done: boolean;
  priority: TaskPriority;
  tags: string[];
  memo: string | null;
  recurrence: string | null;
  url: string | null;
};

export type ReminderItem = {
  kind: "reminder";
  /**
   * 表示上のID。毎年の項目を各年へ展開した回は、元ページのIDへ日付を足した別物になる
   * （services/notion/reminders.ts）。編集の宛先には使えない。
   */
  id: string;
  /** Notionのページ ID。展開した回でも元ページを指す。編集・削除はこちらを使う。 */
  pageId: string;
  title: string;
  /** 対象日。日付のみは YYYY-MM-DD、時刻ありは ISO 8601。 */
  date: string;
  /**
   * 元ページに入っている日付。毎年の項目を展開した回では、登録した年の日付になる。
   * 編集画面はこちらを初期値にする（展開した年で上書きすると起点の年が変わってしまう）。
   */
  sourceDate: string;
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
  /** 日付リマインドDBが設定済みかどうか。追加画面にリマインドを出してよいかの判断に使う。 */
  reminderReady: boolean;
  /** 連携ごとの取得失敗。片方が失敗してももう片方は表示できるようにする。 */
  errors: { source: "google" | "notion"; reason: string }[];
};
