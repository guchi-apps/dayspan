import type { NotionConnection } from "@prisma/client";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { db } from "@/lib/db";
import { getNotionConnection } from "@/services/calendar/write-context";
import { createNotionClient } from "@/services/notion/client";
import { classifyTasks } from "@/services/notion/task-buckets";
import { listShoppingItems, shoppingDatabaseReady } from "@/services/notion/shopping-items";
import { listAllTasks } from "@/services/notion/tasks";
import { combineBadgeCounts, countDueShopping, type BadgeCounts } from "@/services/notifications/badge-count";
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
 * Notionから取り直して数える。取れなかった側は null（バッジを触らない）。
 *
 * 0を返すと「1件も無い」としてバッジが消える。取れなかったことと区別する必要がある。
 * 買い物リストのDBが未設定なら、数える対象が無いだけなので0とする。
 *
 * `want` で外した側はNotionへ問い合わせず null を返す。タスク・買い物の画面は自分の側を
 * 取得済みの一覧から数えており、同じ全件取得をバッジのためにもう一度走らせないため（§20）。
 */
export async function loadBadgeCounts(
  userId: string,
  want: { tasks: boolean; shopping: boolean } = { tasks: true, shopping: true },
): Promise<BadgeCounts> {
  const connection = await getNotionConnection(userId);
  if (!connection) return combineBadgeCounts(null, null);

  const uiSetting = await db.uiSetting.findUnique({
    where: { userId },
    select: { timeZone: true },
  });
  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";
  const notion = createNotionClient(connection);

  const [tasks, shopping] = await Promise.all([
    want.tasks
      ? listAllTasks(notion, connection).then(
          (list) => countDueTasks(list, timeZone),
          (error) => {
            console.error("[dayspan] badge count failed:", error);
            return null;
          },
        )
      : null,
    want.shopping ? countShopping(notion, connection, timeZone) : null,
  ]);

  return combineBadgeCounts(tasks, shopping);
}

/** 買い物の件数。DB未設定は0、取得失敗は null。 */
export async function countShopping(
  notion: ReturnType<typeof createNotionClient>,
  connection: NotionConnection,
  timeZone: string,
): Promise<number | null> {
  if (!shoppingDatabaseReady(connection)) return 0;
  try {
    const items = await listShoppingItems(notion, connection);
    return countDueShopping(items, createCalendarDateUtils(timeZone).todayKey());
  } catch (error) {
    console.error("[dayspan] shopping badge count failed:", error);
    return null;
  }
}
