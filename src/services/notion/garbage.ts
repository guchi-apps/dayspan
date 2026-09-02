import type { Client } from "@notionhq/client";
import type { NotionConnection } from "@prisma/client";

import type { ReminderItem } from "@/types/calendar";
import type { ReminderPropertyMap } from "./reminder-database";
import { dateRangeFilter, normalizeDatePage, queryDatePages } from "./reminders";

/**
 * ゴミの収集日（docs/spec.md §9）。
 *
 * myroomが今日から60日先までを毎日計算し直して書き出すDBで、**myroomが正**。
 * DaySpanからは読むだけで、作成・編集・削除は行わない（直しても次の同期で戻るため）。
 *
 * プロパティ構成は日付リマインドDB（タイトル / 日付 / 種類 / メモ）の部分集合で、
 * 「毎年」は持たない。読み方も同じなので、正規化とクエリは reminders.ts のものを共用し、
 * 出どころ（source）だけを分ける。
 */
export async function listGarbageDaysInRange(
  notion: Client,
  connection: NotionConnection,
  range: { from: string; to: string },
): Promise<ReminderItem[]> {
  const map = (connection.garbagePropertyMap as ReminderPropertyMap | null) ?? {};
  if (!connection.garbageDataSourceId || !map.date) return [];

  const pages = await queryDatePages(
    notion,
    connection.garbageDataSourceId,
    dateRangeFilter(map.date, range),
  );

  return dropDuplicates(
    pages
      .map((page) => normalizeDatePage(page, map, "garbage"))
      .filter((item): item is ReminderItem => item !== null),
  );
}

/**
 * 日時も品目も同じページが2件以上あるときは、先頭の1件だけを残す（issue #506）。
 *
 * 粒度は「収集日 × 品目」で1ページ（docs/spec.md §9）なので、中身まで同じページが並ぶのは
 * 書き出し側（myroom）の作り直しの名残でしかない。myroomは次の同期で余分なほうを片付けるが、
 * 同期は1日1回のため、それまでの間はカレンダーに同じ品目が2つ並ぶ。DaySpanはこのDBを
 * 読むだけで消す手立てが無いため（同上）、描く前に潰すしかない。
 *
 * 潰すのは日時まで一致するものだけにする。同じ日で時刻だけが違う2件は、収集時刻を変えた後の
 * ページと変える前のページのどちらが今の値なのかをDaySpan側から決められない。片方を落とすと、
 * 出す時刻を間違えて伝えることになる。
 */
function dropDuplicates(items: ReminderItem[]): ReminderItem[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    // 日付（YYYY-MM-DD / ISO 8601）に空白は入らないので、最初の空白が必ず日付と品目名の境目になる。
    const key = `${item.date} ${item.title}`;
    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}
