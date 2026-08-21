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
  /**
   * このカレンダーへ書き込めないかどうか。設定で「使用」をオフにしたカレンダーと、
   * 読み取り専用で共有されたカレンダーが該当する。移動・編集・削除の入口を出さない判断に使う。
   */
  readOnly: boolean;
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
  /**
   * 予定への紐づけ（docs/spec.md §31）。紐づいているタスクの予定日は、この予定の段階から決まる。
   * Notionから読んだ時点では分からないため、読み込み側（services/task-links）で埋める。
   */
  link: TaskEventLinkItem | null;
  url: string | null;
};

/** タスクを予定のどの段階に置くか。Prismaの TaskEventStage と同じ並びにする。 */
export const TASK_EVENT_STAGES = ["BEFORE_START", "DURING", "BEFORE_END", "AFTER_END"] as const;

export type TaskEventStage = (typeof TASK_EVENT_STAGES)[number];

export const TASK_EVENT_STAGE_LABELS: Record<TaskEventStage, string> = {
  BEFORE_START: "開始まで",
  DURING: "実施中",
  BEFORE_END: "終了まで",
  AFTER_END: "終了後",
};

export function isTaskEventStage(value: unknown): value is TaskEventStage {
  return typeof value === "string" && (TASK_EVENT_STAGES as readonly string[]).includes(value);
}

/**
 * タスクと予定の紐づけ（docs/spec.md §31）。
 *
 * 本体はDaySpanのDBにある。Google Calendarの予定にもNotionのタスクにも「相手を指す欄」は無く、
 * 足せば利用者のDBの構成を変えることになるため、結ぶ線だけをDaySpanが持つ。
 */
export type TaskEventLinkItem = {
  id: string;
  taskId: string;
  calendarId: string;
  eventId: string;
  stage: TaskEventStage;
  /** 予定名。一次情報源はGoogleで、予定が手元にあるときは最新の値へ差し替えて渡す。 */
  eventTitle: string;
  /** 最後に予定日へ入れた日時。時刻なしは YYYY-MM-DD、時刻ありは ISO 8601。 */
  resolvedAt: string;
  resolvedAllDay: boolean;
  /**
   * 紐づけ先の予定が動き、タスクの予定日と食い違っているか。
   * 予定が取得範囲に無いときは判定できないため false（ずれていないとは限らない）。
   */
  drifted: boolean;
  /** ずれているときの、いまの予定から決まる日時。「予定に合わせる」で入る値。 */
  expectedAt: string | null;
};

export type ReminderItem = {
  kind: "reminder";
  /**
   * この項目の出どころ。garbage は myroom が日次で書き直すゴミの収集日で、DaySpanからは読むだけ。
   * 描画・並び順は日付リマインドと同じ経路を通すため、kind ではなくこの項目で分ける
   * （docs/spec.md §9）。編集・削除の入口を出すかどうかの判断に使う。
   */
  source: "reminder" | "garbage";
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

/** 交通手段。Prismaの TravelMode と同じ並びにする。 */
export const TRAVEL_MODES = [
  "TRAIN",
  "CAR",
  "BUS",
  "WALK",
  "BICYCLE",
  "PLANE",
  "OTHER",
] as const;

export type TravelMode = (typeof TRAVEL_MODES)[number];

export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  TRAIN: "電車",
  CAR: "車",
  BUS: "バス",
  WALK: "徒歩",
  BICYCLE: "自転車",
  PLANE: "飛行機",
  OTHER: "その他",
};

export function isTravelMode(value: unknown): value is TravelMode {
  return typeof value === "string" && (TRAVEL_MODES as readonly string[]).includes(value);
}

/**
 * 移動（docs/spec.md §29）。出発地・目的地・交通手段はGoogle Calendarの予定には入らないため、
 * 本体はDaySpanのDBにあり、Googleへは写しを書き出す。
 */
export type TravelItem = {
  kind: "travel";
  id: string;
  /**
   * 表示名（「自宅 → 渋谷」）。出発地・目的地から組み立てた文字列を持つのは、
   * 並び順や検索のように種類を問わず名前だけを見る処理から、移動だけ別扱いにしないため。
   */
  title: string;
  origin: string;
  destination: string;
  mode: TravelMode;
  /** ISO 8601。移動は必ず時刻を持つ（終日の移動という概念が無い）。 */
  start: string;
  end: string;
  note: string | null;
  /** 所要時間がAIの見積もりかどうか。目安であることを画面で示すために持つ。 */
  estimated: boolean;
  /** 元になった予定。予定側から「移動を足す」の済み・未済を判断するために持つ。 */
  linkedEventId: string | null;
  /** 復路かどうか。同じ予定から2件作られたときの並び順・表示に使う。 */
  returnLeg: boolean;
  /** Googleへ書き出せているか。未設定・失敗のときは画面で理由を示す。 */
  exported: boolean;
};

export type CalendarItem = CalendarEventItem | TaskItem | ReminderItem | TravelItem;

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
  travels: TravelItem[];
  calendars: WritableCalendar[];
  notionReady: boolean;
  /** 日付リマインドDBが設定済みかどうか。追加画面にリマインドを出してよいかの判断に使う。 */
  reminderReady: boolean;
  /** 連携ごとの取得失敗。片方が失敗してももう片方は表示できるようにする。 */
  errors: { source: "google" | "notion"; reason: string }[];
};
