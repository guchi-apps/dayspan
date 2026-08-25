/**
 * 勤務場所と出張（docs/spec.md §34）。
 *
 * 通常の勤務も出張も、Notionの勤務記録DBにある同じ形のページとして扱う。
 * 違うのは日付が範囲かどうかと「出張」チェックだけで、種類として分けない。
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
  businessTrip: boolean;
  preApplied: boolean;
  postRegistered: boolean;
  memo: string | null;
  url: string | null;
};

/**
 * 勤務記録DBで何が使えるか。
 *
 * 出張・事前申請・事後登録は名前が当たったときだけ対応付ける任意プロパティのため、
 * 既存のDBを選んだ場合は揃っていないことがある。使えないものを画面から出すと、
 * 押しても保存されない操作が残るため、揃っているかどうかを画面まで渡す。
 */
export type WorkCapabilities = {
  businessTrip: boolean;
  approval: boolean;
  memo: boolean;
};

/** 出張について、まだ済ませていない手続き。 */
export type WorkTodo = "preApplied" | "postRegistered";

export const WORK_TODO_LABELS: Record<WorkTodo, string> = {
  preApplied: "事前申請",
  postRegistered: "事後登録",
};

/**
 * その出張で未対応の手続き。
 *
 * 事後登録は終了日を過ぎてから数える。出張の前から未対応に混ざると、まだできないものが
 * 件数に含まれ続け、いま手を打つべき件数として読めなくなるため。
 */
export function workTodos(record: WorkRecordItem, todayKey: string): WorkTodo[] {
  if (!record.businessTrip) return [];

  const todos: WorkTodo[] = [];
  if (!record.preApplied) todos.push("preApplied");
  if (!record.postRegistered && record.endDate < todayKey) todos.push("postRegistered");
  return todos;
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

/** その記録が指定の日にかかっているか。出張は期間の全ての日にかかる。 */
export function coversDate(record: WorkRecordItem, dateKey: string): boolean {
  return record.startDate <= dateKey && dateKey <= record.endDate;
}
