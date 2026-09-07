import { dateKeyDiffDays } from "@/lib/calendar-range";
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

export type TaskSort = "due" | "priority" | "planned";

export const TASK_SORTS: TaskSort[] = ["due", "priority", "planned"];

export const TASK_SORT_LABELS: Record<TaskSort, string> = {
  due: "期限順",
  priority: "優先度順",
  planned: "予定順",
};

/**
 * 予定順で分類しているときの見出し。期限だけでなく予定日も基準に含むため、
 * 「期限」という言葉のままだと、予定日だけが過ぎている・予定日だけがあるタスクの区分として
 * 誤解を招く（issue #572 計画レビュー指摘）。
 */
export const TASK_BUCKET_LABELS_PLANNED: Record<TaskBucketKey, string> = {
  overdue: "超過",
  today: "今日",
  upcoming: "今後",
  someday: "未設定",
  done: "完了",
};

/** 並び順に応じた区分見出し。並び順ごとに分類の基準日が変わるため、見出しもそれに合わせる。 */
export function taskBucketLabels(sort: TaskSort): Record<TaskBucketKey, string> {
  return sort === "planned" ? TASK_BUCKET_LABELS_PLANNED : TASK_BUCKET_LABELS;
}

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

/**
 * 分類・超過表示の基準にする日付。予定順のときだけ予定日を優先し、無ければ期限で代える
 * （issue #572）。期限順・優先度順のときは従来どおり期限だけを見る。
 *
 * `classifyTasks` と `TaskRow`（画面側の超過表示）の両方から呼ぶため、判定を1か所に置く。
 */
export function classifyDateOf(task: TaskItem, sort: TaskSort): string | null {
  return sort === "planned" ? (task.planned ?? task.due) : task.due;
}

export function classifyTasks(
  tasks: TaskItem[],
  todayKey: string,
  dateKeyOf: DateKeyOf,
  sort: TaskSort = "due",
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

    const classifyDate = classifyDateOf(task, sort);
    if (!classifyDate) {
      buckets.someday.push(task);
      continue;
    }

    const dateKey = dateKeyOf(classifyDate);
    if (dateKey < todayKey) buckets.overdue.push(task);
    else if (dateKey === todayKey) buckets.today.push(task);
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

/**
 * 予定順。期限は指定していないが予定日だけ入れているタスクも、優先度を確認しながら
 * 上から順に着手できるようにするための並び（issue #572）。予定日を優先し、
 * 予定日が無ければ期限で代える。両方無いものは後ろへ、同じ日時なら優先度→タイトルにする。
 */
function compareByPlanned(a: TaskItem, b: TaskItem): number {
  const keyA = a.planned ?? a.due;
  const keyB = b.planned ?? b.due;
  if (keyA && keyB && keyA !== keyB) return keyA < keyB ? -1 : 1;
  if (keyA && !keyB) return -1;
  if (!keyA && keyB) return 1;

  const priority = priorityRank(a.priority) - priorityRank(b.priority);
  if (priority !== 0) return priority;

  return a.title.localeCompare(b.title, "ja");
}

const SORT_COMPARATORS: Record<TaskSort, (a: TaskItem, b: TaskItem) => number> = {
  due: compareByDue,
  priority: compareByPriority,
  planned: compareByPlanned,
};

export function sortTasks(tasks: TaskItem[], sort: TaskSort): TaskItem[] {
  return [...tasks].sort(SORT_COMPARATORS[sort]);
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

// --- タグでの分類（issue #286） ---
// 期限での分類（上）と切り替えて使う。分類の軸そのものを切り替える形にしたのは、期限の区分の
// 中をさらにタグで小分けすると、1区分に1〜2件しか入らないときに見出しばかりが並ぶため。

/** タグを持たないタスクをまとめるグループのキー。タグ名と衝突しないよう空白で始める。 */
export const NO_TAG_GROUP_KEY = " none";

export const NO_TAG_GROUP_LABEL = "タグなし";

export type TaskTagGroup = {
  /** Reactのkeyと、行に残す他のタグを選り分けるための識別子。タグなしは NO_TAG_GROUP_KEY。 */
  key: string;
  /** 見出しに出す名前。タグなしのグループでは NO_TAG_GROUP_LABEL。 */
  name: string;
  tasks: TaskItem[];
};

/**
 * 未完了タスクをタグごとにまとめる。完了は分類の軸によらず末尾の1つにまとめるため含めない。
 *
 * 複数のタグを持つタスクは、どのタグから探しても見つかるように各グループへ重複して入れる。
 * そのぶん件数の合計は総数と一致しない。先頭のタグの所だけに置く方式にしないのは、
 * Notion側のタグの並び順に依存し、探したタグの下に無いことが起きるため。
 *
 * グループの並びはNotionの選択肢の順（tagCatalog.task の順）にする。選択肢と色はNotionの
 * プロパティ定義が一次情報源のため（docs/spec.md §9）。入力画面から足した直後で、まだ選択肢の
 * 取得に載っていない名前は末尾へ名前順で置く。
 */
export function groupTasksByTag(
  tasks: TaskItem[],
  tagNames: string[],
  sort: TaskSort,
): TaskTagGroup[] {
  const order = new Map(tagNames.map((name, index) => [name, index]));
  const groups = new Map<string, TaskItem[]>();
  const untagged: TaskItem[] = [];

  for (const task of tasks) {
    if (task.done) continue;

    if (task.tags.length === 0) {
      untagged.push(task);
      continue;
    }

    for (const name of task.tags) {
      const bucket = groups.get(name);
      if (bucket) bucket.push(task);
      else groups.set(name, [task]);
    }
  }

  const names = [...groups.keys()].sort((a, b) => {
    const rankA = order.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rankB = order.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b, "ja");
  });

  const result: TaskTagGroup[] = names.map((name) => ({
    key: name,
    name,
    tasks: sortTasks(groups.get(name) ?? [], sort),
  }));

  if (untagged.length > 0) {
    result.push({
      key: NO_TAG_GROUP_KEY,
      name: NO_TAG_GROUP_LABEL,
      tasks: sortTasks(untagged, sort),
    });
  }

  return result;
}

// 桁区切りは環境の既定ロケールに任せず固定する。サーバー（VPSはUTC・enロケール）とブラウザで
// 区切りが変わると描画結果がずれ、ハイドレーションが一致しなくなるため
// （components/calendar/item-layout.ts の経過日数と同じ理由）。
const OVERDUE_DAYS_FORMAT = new Intl.NumberFormat("ja-JP");

/**
 * 基準日（期限、予定順のときは予定日）を過ぎたタスクに添える超過日数のラベル（「5日超過」）。
 * 今日・これからの基準日では null。
 *
 * 「期限切れ」「超過」に入っていることは分類で分かるが、昨日過ぎたのか半年放置しているのかは分からない。
 */
export function overdueDaysLabel(dateKey: string, todayKey: string): string | null {
  if (dateKey >= todayKey) return null;
  return `${OVERDUE_DAYS_FORMAT.format(dateKeyDiffDays(dateKey, todayKey))}日超過`;
}
