import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { db } from "@/lib/db";
import { getNotionConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { classifyTasks } from "@/services/notion/task-buckets";
import { listAllTasks } from "@/services/notion/tasks";
import type { TaskItem } from "@/types/calendar";

/**
 * アプリアイコンのバッジに出す件数（docs/spec.md §32）。
 *
 * 数えるのは期限が今日以前の未完了タスク。タスク画面の分類の軸が期限のままのため
 * （docs/spec.md §11）、同じ関数を通しておけば見出しの「期限切れ」「今日」の合計と必ず一致する。
 * 予定日を混ぜると、画面のどの数字とも合わない件数がアイコンに出ることになる。
 */
export function countDueTasks(tasks: TaskItem[], timeZone: string): number {
  const utils = createCalendarDateUtils(timeZone);
  const buckets = classifyTasks(tasks, utils.todayKey(), utils.itemDateKey);
  return buckets.overdue.length + buckets.today.length;
}

/**
 * Notionから取り直して数える。Notionが未接続・取得できないときは null（バッジを触らない）。
 *
 * 0を返すと「タスクが1件も無い」としてバッジが消える。取れなかったことと区別する必要がある。
 */
export async function loadBadgeCount(userId: string): Promise<number | null> {
  const connection = await getNotionConnection(userId);
  if (!connection) return null;

  const uiSetting = await db.uiSetting.findUnique({
    where: { userId },
    select: { timeZone: true },
  });

  try {
    const tasks = await listAllTasks(createNotionClient(connection), connection);
    return countDueTasks(tasks, uiSetting?.timeZone ?? "Asia/Tokyo");
  } catch (error) {
    console.error("[dayspan] badge count failed:", error);
    return null;
  }
}
