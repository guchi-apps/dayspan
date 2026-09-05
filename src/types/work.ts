/**
 * 勤務場所・出張・年休・会社休業日（docs/spec.md §34）。
 *
 * 通常の勤務も出張も年休も会社休業日も、Notionの勤務記録DBにある同じ形のページとして扱う。
 * 違うのは日付が範囲かどうかと「出張」「会社休業日」チェック・「年休」の区分だけで、
 * 種類として分けない。
 */
export type WorkRecordItem = {
  /** Notionのページ ID */
  id: string;
  title: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD。単日の記録では startDate と同じ値を入れる。 */
  endDate: string;
  /** 勤務場所（Notionのselectの選択肢）。DBに列が無い・未入力なら null。 */
  place: string | null;
  /**
   * 年休の区分（全休・午前半休・午後半休・`N時間休`）。年休ではない日は null。
   *
   * チェック2つ（年休か・半休か）ではなく1つのselectで持つのは、「半休なのに全休が立つ」
   * 組み合わせを作れないようにするため。時間休は時間数を名前へ含める（`3時間休`）。
   */
  annualLeave: string | null;
  businessTrip: boolean;
  /**
   * 会社が休みの日（お盆・年末年始・創立記念日など）。
   *
   * 年休と違って申請するものが無く、勤務場所も入らない。年休のselectへ「会社休業日」という
   * 選択肢を足す形にしないのは、Notionで名前を直した瞬間に振る舞いが変わり、直した本人にも
   * 原因が読めなくなるため（年休を専用のプロパティにしたのと同じ理由）。
   */
  companyHoliday: boolean;
  preApplied: boolean;
  postRegistered: boolean;
  memo: string | null;
  url: string | null;
};

/**
 * 勤務記録DBで何が使えるか。
 *
 * 年休・出張・会社休業日・事前申請・事後登録は名前が当たったときだけ対応付ける任意プロパティの
 * ため、既存のDBを選んだ場合は揃っていないことがある。使えないものを画面から出すと、
 * 押しても保存されない操作が残るため、揃っているかどうかを画面まで渡す。
 */
export type WorkCapabilities = {
  businessTrip: boolean;
  /** 年休を登録し、事前申請の済み未済まで持てるか。 */
  annualLeave: boolean;
  /** 会社休業日を登録できるか。申請を持たないため、必要なのはこの列だけ。 */
  companyHoliday: boolean;
  approval: boolean;
  memo: boolean;
};

/**
 * 名称を入れずに登録した会社休業日のタイトル。
 *
 * Notionの一覧で開かずに読める名前が要るため、空にはしない。画面ではこの値かどうかで
 * 「名称が付いていない休業」だと判断する（入力欄の初期値・一覧の表記・カレンダーのチップ）。
 */
export const COMPANY_HOLIDAY_TITLE = "会社休業日";

/** 出張について、まだ済ませていない手続き。 */
export type WorkTodo = "preApplied" | "postRegistered";

export const WORK_TODO_LABELS: Record<WorkTodo, string> = {
  preApplied: "事前申請",
  postRegistered: "事後登録",
};

/**
 * その記録で未対応の手続き。
 *
 * 会社休業日は何も持たない（会社が決めた休みで、出す申請が無い）。年休が持つのは事前申請だけ。
 * 休んだことを後から届け出る手続きは無く、出張の事後登録にあたるものが存在しない。
 *
 * 事後登録は終了日を過ぎてから数える。出張の前から未対応に混ざると、まだできないものが
 * 件数に含まれ続け、いま手を打つべき件数として読めなくなるため。事前申請は日付によらず
 * 未対応に数える（過ぎた日でも申請そのものは残っている）。
 */
export function workTodos(record: WorkRecordItem, todayKey: string): WorkTodo[] {
  // 会社休業日は会社が決めた休みで、出す申請も後からの届け出も無い。
  if (record.companyHoliday) return [];
  if (record.annualLeave) return record.preApplied ? [] : ["preApplied"];
  if (!record.businessTrip) return [];

  const todos: WorkTodo[] = [];
  if (!record.preApplied) todos.push("preApplied");
  if (!record.postRegistered && record.endDate < todayKey) todos.push("postRegistered");
  return todos;
}

/**
 * 出張・年休の区画に出す記録。手続きが残っているものだけを日付順に並べる。
 *
 * 済んだものをその月のあいだ並べたままにすると、開く理由（まだ済ませていないものを片付ける）に
 * 対して読むものが増えるだけになる。出張の前で事後登録だけが残っている記録も、`workTodos()` が
 * 終了日を過ぎるまで数えないため一緒に落ちる（日付の規則をここへ二重に持たない）。
 * 済んだ記録は日別の一覧に残っており、行を押せば入力ダイアログから外せる（issue #412）。
 */
export function openWorkRecords(records: WorkRecordItem[], todayKey: string): WorkRecordItem[] {
  return records
    .filter((record) => workTodos(record, todayKey).length > 0)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** 行に出すチェックボックス1件ぶんの状態。 */
export type WorkTodoState = {
  todo: WorkTodo;
  done: boolean;
  /**
   * いま押せないか。
   *
   * 事後登録は出張の翌日以降にしかできないため、終了日を過ぎるまでは押せない状態のまま
   * チェックボックスを残す（issue #509）。以前はチップごと非表示にしていたが、それだと
   * 「事前申請は済んでいるが、この出張には事後登録も要る」ことが行から読めなかった。
   * 既にtrueのものはdisabledにしない（取り消して直せるようにするため）。
   */
  disabled: boolean;
};

/** 行に出すチェックボックスの状態を組み立てる。表示するかどうかの絞り込みは行わない。 */
export function workTodoStates(
  record: WorkRecordItem,
  todayKey: string,
  todos: WorkTodo[],
): WorkTodoState[] {
  return todos.map((todo) => {
    const done = todo === "preApplied" ? record.preApplied : record.postRegistered;
    const disabled = todo === "postRegistered" && !done && !(record.endDate < todayKey);
    return { todo, done, disabled };
  });
}

/**
 * その勤務場所が出張扱いか。
 *
 * 「行けば必ず出張になる勤務先」を場所ごとに覚えておき（NotionConnection.workTripPlaces）、
 * その場所を選んだ時点で出張の既定を立てる。未選択（null・空文字）は出張ではない。
 */
export function isTripPlace(tripPlaces: string[], place: string | null | undefined): boolean {
  return Boolean(place) && tripPlaces.includes(place as string);
}

/**
 * 1日の所定労働時間（分）の既定。7時間45分（docs/spec.md §34）。
 *
 * 時間休が1日ぶんの何割かを決める値で、`UiSetting.workMinutesPerDay` に持つ。使うのは
 * 入力ダイアログの時間数の上限と、年休画面の帯・消化ペースの比率だけ。年休を**数える**
 * 処理では使わない（全休・半休は日、時間休は時間のまま数え、1つの数へ丸めないため）。
 */
export const DEFAULT_WORK_MINUTES_PER_DAY = 465;

/** 所定労働時間として受け付ける分数か。壊れた値は既定として扱う（設定が読めないことを理由に画面を止めない）。 */
export function normalizeWorkMinutes(minutes: number | null | undefined): number {
  if (
    typeof minutes !== "number" ||
    !Number.isInteger(minutes) ||
    minutes < 60 ||
    minutes > 1440
  ) {
    return DEFAULT_WORK_MINUTES_PER_DAY;
  }
  return minutes;
}

/** 区分の名前から時間数を読むための形（`3時間休`）。 */
const HOURLY_LEAVE_PATTERN = /(\d+(?:\.\d+)?)?\s*時間/;

/**
 * 時間休の時間数。時間休でない区分（全休・半休）は null。
 *
 * 半休を名前の「半」で 0.5 日と数えているのと同じで、区分の名前から読む（docs/spec.md §34）。
 * Notionのselectは書き込んだ名前がそのまま選択肢になるため、`3時間休` を保存すれば選択肢も
 * その場で増える。年休の列を1つ足してもらう必要が無い。
 *
 * 数字の無い `時間休` は 1 時間として読む。時間休だと分かっているものを丸一日として
 * 数えるほうが、実際との開きが大きいため。
 */
export function annualLeaveHours(kind: string | null): number | null {
  if (!kind) return null;
  const matched = HOURLY_LEAVE_PATTERN.exec(kind);
  if (!matched) return null;
  const hours = matched[1] === undefined ? 1 : Number(matched[1]);
  return Number.isFinite(hours) && hours > 0 ? hours : 1;
}

/**
 * 年休1日ぶんの日数。半休は 0.5 日、**時間休は 0 日**（時間の側で数えるため）。
 *
 * 区分の名前で決める。DaySpanが作る選択肢は全休・午前半休・午後半休の3つだが、Notionの
 * selectは書き込んだ名前がそのまま選択肢になるため、利用者が足した名前でも同じ規則で読める。
 * 月の集計（勤怠の提出で見る数字）が半休を1日として数えると使えないため、ここで分ける。
 */
export function annualLeaveDays(kind: string | null): number {
  if (!kind) return 0;
  if (annualLeaveHours(kind) !== null) return 0;
  return kind.includes("半") ? 0.5 : 1;
}

/**
 * 1日を丸ごと休むわけではない年休（半休・時間休）か。
 *
 * 残り半分（残りの時間）の勤務場所を持ち、期間では登録できない、という扱いが同じ。
 * 判定を `annualLeaveDays()` の値から起こさないのは、時間休の日数が 0 で、全休（1）とも
 * 半休（0.5）とも別の値になるため。1日ぶんかどうかは名前から直接決める。
 */
export function isPartialLeave(kind: string | null): boolean {
  if (!kind) return false;
  return annualLeaveHours(kind) !== null || kind.includes("半");
}

/** 集計に出す日数。整数の日を `12.0` と出さない。 */
export function formatDays(days: number): string {
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}

/**
 * 集計に出す時間数。`3時間`。
 *
 * 時間休は1時間単位でしか入らないため、合計にも端数が出ない。小数を付けるのは、Notionで
 * 手書きされた `1.5時間休` のような値を受けたときだけ（`formatDays()` と同じ扱い）。
 */
export function formatLeaveHours(hours: number): string {
  return `${Number.isInteger(hours) ? String(hours) : hours.toFixed(2)}時間`;
}

/** その記録が指定の日にかかっているか。出張は期間の全ての日にかかる。 */
export function coversDate(record: WorkRecordItem, dateKey: string): boolean {
  return record.startDate <= dateKey && dateKey <= record.endDate;
}
