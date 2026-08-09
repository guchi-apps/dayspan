/** 週の開始日の選択肢。曜日番号（0=日曜）で持ち、Google Calendarと同じ3つだけを扱う。 */
export const WEEK_START_OPTIONS = [
  { value: 0, label: "日曜日" },
  { value: 1, label: "月曜日" },
  { value: 6, label: "土曜日" },
];

/** 保存済みの値が選択肢から外れていても画面が壊れないよう、既定へ寄せる。 */
export function weekStartLabel(weekStartsOn: number): string {
  return WEEK_START_OPTIONS.find((option) => option.value === weekStartsOn)?.label ?? "日曜日";
}
