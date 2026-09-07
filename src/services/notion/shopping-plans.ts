import type { Client } from "@notionhq/client";
import type { NotionConnection } from "@prisma/client";

import type { ReminderItem } from "@/types/calendar";
import { sortShoppingItems, type ShoppingItem } from "@/types/shopping";

import { dateRangeFilter, queryDatePages } from "./reminders";
import { normalizeShoppingPage, shoppingPropertyMap, type ShoppingPage } from "./shopping-items";

/**
 * 購入予定日のある買い物を、カレンダーへ出す形にする（docs/spec.md §36）。
 *
 * 読み取りと描画は日付リマインドの経路をそのまま流用し、出どころ（`ReminderItem.source`）だけを
 * 分ける。ゴミの日（`garbage.ts`）とまったく同じ扱いで、新しい `kind` を作ると月表示・時間グリッド・
 * 並び順・チャンク保持の全てに同じ描画をもう1系統足すことになる。リマインドは掴んで動かす対象では
 * ないため、ドラッグの経路にも手が要らない。
 *
 * **その日に何件あっても1件にまとめる。** 品目ごとに並べると、買い物を入れた日だけ予定・タスクが
 * その下へ押し出される。カレンダーで読みたいのは「その日に買い物があるか」と、その量まで。
 * 品目はまとめた枠を押したときに読める（メモとして持つ）。
 */
export function shoppingPlanReady(connection: NotionConnection | null): boolean {
  if (!connection?.shoppingDataSourceId) return false;
  const map = shoppingPropertyMap(connection);
  return Boolean(map.title && map.plannedDate);
}

export async function listShoppingPlansInRange(
  notion: Client,
  connection: NotionConnection,
  range: { from: string; to: string },
): Promise<ReminderItem[]> {
  if (!connection.shoppingDataSourceId || !shoppingPlanReady(connection)) return [];
  const map = shoppingPropertyMap(connection);

  // 買い物リストの全件取得（`has_more` の間ページング）は月を送るたびに通さない。
  // 表示範囲に予定日が入っているものだけを問い合わせる（docs/spec.md §20）。
  const pages = await queryDatePages(
    notion,
    connection.shoppingDataSourceId,
    dateRangeFilter(map.plannedDate!, range),
  );

  const items = pages
    .map((page) => normalizeShoppingPage(page as ShoppingPage, map))
    // 数えるのは未購入のものだけ。買い物中に見るのは残っているもの、という一覧側の扱いと
    // 同じにする。その日のぶんを全部買い終えると、カレンダーからも枠ごと消える。
    .filter((item): item is ShoppingItem => item !== null && !item.bought && item.plannedDate !== null);

  const byDate = new Map<string, ShoppingItem[]>();
  for (const item of items) {
    const dateKey = item.plannedDate!;
    const bucket = byDate.get(dateKey);
    if (bucket) bucket.push(item);
    else byDate.set(dateKey, [item]);
  }

  return [...byDate.entries()].map(([dateKey, dayItems]) => toPlanItem(dateKey, dayItems));
}

function toPlanItem(dateKey: string, items: ShoppingItem[]): ReminderItem {
  // 品目は先に買うべきものから並べる（ウィジェットの買い物の面と同じ理由）。
  const ordered = sortShoppingItems(items, "priority");

  return {
    kind: "reminder",
    source: "shopping",
    // 元になるページが複数あるため、IDは日付で作る。月ごとに保持するときの一意性はこれで足りる。
    id: `shopping:${dateKey}`,
    // 編集・削除の宛先には使わない。買い物リストDBはDaySpanの外（shopping-list）とも
    // 共用するため、カレンダーの枠からは中身を変えられないようにしている。
    pageId: "",
    // 件数は項目名と同じ1つの文字列として流す。別の要素に分けて縮まないようにすると、枠が
    // 狭いときに削られるのが項目名の側になる（CLAUDE.md「枠に添える補助ラベル」）。
    title: `買い物 ${ordered.length}件`,
    date: dateKey,
    sourceDate: dateKey,
    hasTime: false,
    category: null,
    // 押したときに何を買うのかが読めるようにする。メモの入っている項目はそれも添える
    // （「2本」のような数量は、買い物中にいちばん確かめたい値）。
    memo: ordered.map((item) => `・${item.name}${item.memo ? `（${item.memo}）` : ""}`).join("\n"),
    annual: false,
    url: null,
  };
}
