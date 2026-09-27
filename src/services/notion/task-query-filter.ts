import type { NotionFilterGroup, NotionQueryFilter } from "./client";

export type OverdueTaskRange = {
  from: string;
  before: string;
};

export function taskRangeFilter(
  dueProperty: string,
  plannedProperty: string | undefined,
  range: { from: string; to: string },
  overdueRange?: OverdueTaskRange,
): NotionQueryFilter {
  const withinRange = (property: string): NotionFilterGroup => ({
    and: [
      { property, date: { on_or_after: range.from } },
      { property, date: { on_or_before: range.to } },
    ],
  });

  const filters: NotionFilterGroup[] = [withinRange(dueProperty)];
  if (plannedProperty) filters.push(withinRange(plannedProperty));
  // カレンダーでは期限切れを今日へ寄せる。予定日だけが過去のタスクを混ぜないよう、
  // 追加する条件は期限プロパティだけに限る（issue #817）。
  if (overdueRange) {
    filters.push({
      and: [
        { property: dueProperty, date: { on_or_after: overdueRange.from } },
        { property: dueProperty, date: { before: overdueRange.before } },
      ],
    });
  }

  return filters.length === 1 ? filters[0] : { or: filters };
}
