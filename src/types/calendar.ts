// カレンダー画面が扱う表示用の型。Google Calendar / Notion のレスポンス形をそのままUIへ
// 持ち込まず、ここで1つの形に正規化する（docs/spec.md §22）。

import type { WorkRecordItem } from "./work";

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
   * 予定への紐づけ（docs/spec.md §31）。紐づいている日付（期限・予定日）は、その予定の段階から決まる。
   * Notionから読んだ時点では分からないため、読み込み側（services/task-links）で埋める。
   * 行き先ごとに1件のため、多くても期限と予定日の2件になる。
   */
  links: TaskEventLinkItem[];
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
 * 段階から決まる日時をタスクのどちらの日付へ入れるか（docs/spec.md §31）。
 * Prismaの TaskLinkTarget と同じ並びにする。
 */
export const TASK_LINK_TARGETS = ["DUE", "PLANNED"] as const;

export type TaskLinkTarget = (typeof TASK_LINK_TARGETS)[number];

export const TASK_LINK_TARGET_LABELS: Record<TaskLinkTarget, string> = {
  DUE: "期限",
  PLANNED: "予定日",
};

/** 行き先を選ばずに紐づけたときの既定。行き先を足す前の紐づけはすべて予定日へ書いていた。 */
export const DEFAULT_TASK_LINK_TARGET: TaskLinkTarget = "PLANNED";

export function isTaskLinkTarget(value: unknown): value is TaskLinkTarget {
  return typeof value === "string" && (TASK_LINK_TARGETS as readonly string[]).includes(value);
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
  /** 決まった日時の行き先。期限と予定日で別の予定へ紐づけられる。 */
  target: TaskLinkTarget;
  /** 予定名。一次情報源はGoogleで、予定が手元にあるときは最新の値へ差し替えて渡す。 */
  eventTitle: string;
  /** 最後に行き先へ入れた日時。時刻なしは YYYY-MM-DD、時刻ありは ISO 8601。 */
  resolvedAt: string;
  resolvedAllDay: boolean;
  /**
   * 紐づけ先の予定が動き、タスクの日付（行き先）と食い違っているか。
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

/**
 * 交通手段。Prismaの TravelMode と同じ並びにする。
 *
 * 電車・バス・飛行機はいずれもYahoo!乗換案内で経路検索できるため、公共交通として1つに
 * まとめる（issue #538）。自転車はどの分類にも当てはまらないため、その他へ含める。
 */
export const TRAVEL_MODES = ["CAR", "PUBLIC_TRANSIT", "WALK", "OTHER"] as const;

export type TravelMode = (typeof TRAVEL_MODES)[number];

export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  CAR: "車",
  PUBLIC_TRANSIT: "公共交通",
  WALK: "徒歩",
  OTHER: "その他",
};

export function isTravelMode(value: unknown): value is TravelMode {
  return typeof value === "string" && (TRAVEL_MODES as readonly string[]).includes(value);
}

/**
 * 所要時間の出どころ。Prismaの TravelEstimateSource と同じ並びにする。
 *
 * TRANSIT は trainroute 経由で引いた経路検索の結果。AIの見積もりと同じく確定した時刻では
 * ないが、実際の路線網・乗換・徒歩を計算した値で、精度が違う。
 *
 * YAHOO は、利用者がYahoo!乗換案内で選んでコピーした経路（docs/spec.md §29）。**これだけは
 * 実際のダイヤ上の列車**で、他の3つのように「目安」「平均」と断る値ではない。
 */
export const TRAVEL_ESTIMATE_SOURCES = ["MANUAL", "AI", "TRANSIT", "YAHOO"] as const;

export type TravelEstimateSource = (typeof TRAVEL_ESTIMATE_SOURCES)[number];

export function isTravelEstimateSource(value: unknown): value is TravelEstimateSource {
  return typeof value === "string" && (TRAVEL_ESTIMATE_SOURCES as readonly string[]).includes(value);
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
  /**
   * 所要時間が手入力でないかどうか。「（目安）」を出す条件に使う。
   * どこから来た値かは estimateSource が持つ。
   */
  estimated: boolean;
  /** 所要時間の出どころ（docs/spec.md §29）。 */
  estimateSource: TravelEstimateSource;
  /** 元になった予定。予定側から「移動を足す」の済み・未済を判断するために持つ。 */
  linkedEventId: string | null;
  /** 復路かどうか。同じ予定から2件作られたときの並び順・表示に使う。 */
  returnLeg: boolean;
  /** Googleへ書き出せているか。未設定・失敗のときは画面で理由を示す。 */
  exported: boolean;
  /**
   * 書き出し先Googleカレンダーの色（issue #492）。背景の塗りに使う。
   * 未書き出し・書き出し失敗、または書き出し先が「使用」オフになっている場合は null で、
   * eventColors(null) の既定色（FALLBACK）に落ちる。
   */
  color: string | null;
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
  /**
   * その日の勤務場所（docs/spec.md §34）。予定・タスクと違い、時刻も長さも持たない「日の属性」で、
   * カレンダーでは項目の並ぶ面ではなく日付の見出しに出す。CalendarItem には含めない。
   */
  workRecords: WorkRecordItem[];
  calendars: WritableCalendar[];
  notionReady: boolean;
  /** 日付リマインドDBが設定済みかどうか。追加画面にリマインドを出してよいかの判断に使う。 */
  reminderReady: boolean;
  /** 連携ごとの取得失敗。片方が失敗してももう片方は表示できるようにする。 */
  errors: { source: "google" | "notion"; reason: string }[];
};
