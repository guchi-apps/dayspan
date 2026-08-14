// 活動記録が扱う表示用の型（docs/spec.md §27）。
// 進行中の1件だけがDaySpanのDBにあり、終わった記録はGoogle Calendarの予定になる。

/** 記録を始めるときに押す選択肢（睡眠・仕事など）。 */
export type ActivityPresetItem = {
  id: string;
  name: string;
  /** 保存先カレンダー。未設定なら予定作成の既定の保存先へ入れる。 */
  calendarId: string | null;
};

/** いま記録している最中の1件。終わるまでGoogle Calendarには存在しない。 */
export type RunningActivityItem = {
  title: string;
  calendarId: string;
  /** 開始日時（ISO 8601）。 */
  startedAt: string;
};

/** 記録の停止で作られた予定がかかる時間帯。呼び出し側がその範囲だけ取り直すために返す。 */
export type ActivitySavedRange = { start: string; end: string };
