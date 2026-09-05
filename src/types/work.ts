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
   * 年休の区分（全休・午前半休・午後半休）。年休ではない日は null。
   *
   * チェック2つ（年休か・半休か）ではなく1つのselectで持つのは、「半休なのに全休が立つ」
   * 組み合わせを作れないようにするため。
   */
  annualLeave: string | null;
  businessTrip: boolean;
  /**
   * 会社が休みの日（お盆・年末年始・創立記念日など。画面では「休み」と呼ぶ）。
   *
   * 年休と違って申請するものが無く、勤務場所も入らない。年休のselectへ「休み」という
   * 選択肢を足す形にしないのは、Notionで名前を直した瞬間に振る舞いが変わり、直した本人にも
   * 原因が読めなくなるため（年休を専用のプロパティにしたのと同じ理由）。Notion側のプロパティ名は
   * `会社休業日`のままにする（既存DBとの対応付けを崩さないため）。
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
  /** 休み（会社休業日）を登録できるか。申請を持たないため、必要なのはこの列だけ。 */
  companyHoliday: boolean;
  approval: boolean;
  memo: boolean;
};

/**
 * 名称を入れずに登録した休みのタイトル（issue #536）。
 *
 * Notionの一覧で開かずに読める名前が要るため、空にはしない。画面ではこの値かどうかで
 * 「名称が付いていない休み」だと判断する（入力欄の初期値・一覧の表記・カレンダーのチップ）。
 */
export const HOLIDAY_TITLE = "休み";

/**
 * 以前の既定タイトル（issue #536で「休み」に統一する前の値）。
 *
 * 過去にこの値で保存済みの記録は、Notion上のタイトルが文字列として`会社休業日`のまま残る。
 * `HOLIDAY_TITLE`だけを見て「名称あり」と判定すると、これらの記録が「休み（会社休業日）」の
 * ような二重表記になるため、名称の有無を判定するときは両方を「名称なし」として扱う。
 */
export const LEGACY_HOLIDAY_TITLE = "会社休業日";

/** タイトルが名称未入力の既定値（新旧どちらか）かどうか。 */
export function isDefaultHolidayTitle(title: string): boolean {
  return title === HOLIDAY_TITLE || title === LEGACY_HOLIDAY_TITLE;
}

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
 * 年休1日ぶんの日数。半休は 0.5 日。
 *
 * 区分の名前で決める。DaySpanが作る選択肢は全休・午前半休・午後半休の3つだが、Notionの
 * selectは書き込んだ名前がそのまま選択肢になるため、利用者が足した名前でも同じ規則で読める。
 * 月の集計（勤怠の提出で見る数字）が半休を1日として数えると使えないため、ここで分ける。
 */
export function annualLeaveDays(kind: string | null): number {
  if (!kind) return 0;
  return kind.includes("半") ? 0.5 : 1;
}

/** 集計に出す日数。整数の日を `12.0` と出さない。 */
export function formatDays(days: number): string {
  return Number.isInteger(days) ? String(days) : days.toFixed(1);
}

/** その記録が指定の日にかかっているか。出張は期間の全ての日にかかる。 */
export function coversDate(record: WorkRecordItem, dateKey: string): boolean {
  return record.startDate <= dateKey && dateKey <= record.endDate;
}
