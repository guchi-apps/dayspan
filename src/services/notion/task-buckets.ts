import type { TaskItem } from "@/types/calendar";

// タスク画面の分類（docs/spec.md §11）。表示だけの都合なので外部APIには依存させず、
// 取得済みのタスクと「今日」の日付から決める。

export type TaskBucketKey = "overdue" | "today" | "upcoming" | "someday" | "done";

export const TASK_BUCKET_LABELS: Record<TaskBucketKey, string> = {
  overdue: "期限切れ",
  today: "今日",
  upcoming: "今後",
  someday: "期限未設定",
  done: "完了",
};

export type TaskSort = "due" | "priority";

const PRIORITY_ORDER: Record<string, number> = { 高: 0, 中: 1, 低: 2 };

function priorityRank(priority: string | null): number {
  if (!priority) return 99;
  return PRIORITY_ORDER[priority] ?? 98;
}

/**
 * 期限の日付キー。時刻ありの期限は表示タイムゾーンでの日付に直す必要があるため、
 * 変換関数を受け取る（画面側の日付解釈と必ず一致させるため）。
 */
type DateKeyOf = (due: string) => string;

export function classifyTasks(
  tasks: TaskItem[],
  todayKey: string,
  dateKeyOf: DateKeyOf,
): Record<TaskBucketKey, TaskItem[]> {
  const buckets: Record<TaskBucketKey, TaskItem[]> = {
    overdue: [],
    today: [],
    upcoming: [],
    someday: [],
    done: [],
  };

  for (const task of tasks) {
    // 完了したタスクは期限に関わらず「完了」へ入れる。履歴として残すため（docs/spec.md §12）。
    if (task.done) {
      buckets.done.push(task);
      continue;
    }

    if (!task.due) {
      buckets.someday.push(task);
      continue;
    }

    const dueKey = dateKeyOf(task.due);
    if (dueKey < todayKey) buckets.overdue.push(task);
    else if (dueKey === todayKey) buckets.today.push(task);
    else buckets.upcoming.push(task);
  }

  return buckets;
}

/** 期限順。期限なしは後ろ、同じ期限なら優先度の高い順にする。 */
function compareByDue(a: TaskItem, b: TaskItem): number {
  if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
  if (a.due && !b.due) return -1;
  if (!a.due && b.due) return 1;

  const priority = priorityRank(a.priority) - priorityRank(b.priority);
  if (priority !== 0) return priority;

  return a.title.localeCompare(b.title, "ja");
}

/** 優先度順。同じ優先度なら期限の早い順にする。 */
function compareByPriority(a: TaskItem, b: TaskItem): number {
  const priority = priorityRank(a.priority) - priorityRank(b.priority);
  if (priority !== 0) return priority;
  return compareByDue(a, b);
}

export function sortTasks(tasks: TaskItem[], sort: TaskSort): TaskItem[] {
  return [...tasks].sort(sort === "priority" ? compareByPriority : compareByDue);
}

/** 完了タスクは履歴なので、新しく期限が来たものから見せる。 */
export function sortDoneTasks(tasks: TaskItem[]): TaskItem[] {
  return [...tasks].sort((a, b) => {
    if (a.due && b.due && a.due !== b.due) return a.due < b.due ? 1 : -1;
    if (a.due && !b.due) return -1;
    if (!a.due && b.due) return 1;
    return a.title.localeCompare(b.title, "ja");
  });
}
