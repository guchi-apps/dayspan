// 活動記録が扱う表示用の型（docs/spec.md §27）。
// 進行中の1件だけがDaySpanのDBにあり、終わった記録はGoogle Calendarの予定になる。

/** 記録を始めるときに押す選択肢（睡眠・仕事など）。 */
export type ActivityPresetItem = {
  id: string;
  name: string;
};

/**
 * いま記録している最中の1件。終わるまでGoogle Calendarには存在しない。
 *
 * 保存先は記録全体で1つ（設定）だが、始めた時点の値をここへ写して持つ。
 * 記録中に設定を変えても、その記録は始めたときの保存先へ入る。
 */
export type RunningActivityItem = {
  title: string;
  calendarId: string;
  /** 開始日時（ISO 8601）。 */
  startedAt: string;
};

/** 記録の停止で作られた予定がかかる時間帯。呼び出し側がその範囲だけ取り直すために返す。 */
export type ActivitySavedRange = { start: string; end: string };
