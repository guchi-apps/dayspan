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

  return pages
    .map((page) => normalizeDatePage(page, map, "garbage"))
    .filter((item): item is ReminderItem => item !== null);
}
