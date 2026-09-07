import { dateKeyDiffDays } from "@/lib/calendar-range";

/**
 * 買い物リストの項目と、その並べ方・束ね方（docs/spec.md §36）。
 *
 * 描画から切り離してここに置くのは、並び順と区分の作り方が画面の見た目とは別に確かめられる
 * ようにするため（タスクの `services/notion/task-buckets.ts` と同じ立ち位置）。
 */

/** 優先度の選択肢。タスク（`TaskPriority`）と同じ言葉に揃える。 */
export const SHOPPING_PRIORITIES = ["高", "中", "低"] as const;

export type ShoppingPriority = (typeof SHOPPING_PRIORITIES)[number] | null;

export type ShoppingItem = {
  id: string;
  name: string;
  /** Notionのカテゴリ（select）。未設定のものもそのまま持ち、束ねるときに「その他」へ入れる。 */
  category: string | null;
  memo: string | null;
  priority: ShoppingPriority;
  /**
   * 購入予定日（`YYYY-MM-DD`）。未設定は null（docs/spec.md §36）。
   *
   * 時刻は持たない。買い物に開始時刻という概念が無く、「今日買う・明日買う」までが決まれば
   * リストとしては足りる。Notion側の日付プロパティに時刻が入っていても、読むときに日付へ落とす。
   */
  plannedDate: string | null;
  bought: boolean;
  url: string | null;
};

/** 並び順。購入済みを末尾へ送るのはどの並びでも共通で、ここには含めない。 */
export type ShoppingSort = "added" | "name" | "priority" | "planned";

export const SHOPPING_SORTS: ShoppingSort[] = ["added", "name", "priority", "planned"];

export const SHOPPING_SORT_LABELS: Record<ShoppingSort, string> = {
  added: "追加順",
  name: "名前順",
  priority: "優先度順",
  planned: "予定日順",
};

/**
 * カテゴリ未設定の項目を束ねる区分。
 *
 * カテゴリはNotion側で任意のプロパティで、付けずに足された項目もある。定義済みのカテゴリだけを
 * 並べると、その項目がどのタブにも出ない（shopping-listではそうなっていた）。買い物リストは
 * 「残っているものが全部見える」ことが前提の一覧なので、必ずどこかに出す。
 */
export const UNCATEGORIZED_KEY = "__uncategorized__";
export const UNCATEGORIZED_LABEL = "その他";

/** タブと区分のキー。カテゴリ名そのものをキーにし、未設定だけ専用のキーへ寄せる。 */
export function categoryKeyOf(item: ShoppingItem): string {
  return item.category ?? UNCATEGORIZED_KEY;
}

export function categoryLabelOf(key: string): string {
  return key === UNCATEGORIZED_KEY ? UNCATEGORIZED_LABEL : key;
}

const PRIORITY_ORDER: Record<string, number> = { 高: 0, 中: 1, 低: 2 };

/**
 * 並び替え。
 *
 * 購入済みは並び順によらず必ず末尾へ送る。買い物中に見るのは残っているもので、
 * 名前順・優先度順で買ったものが上に混ざると、残りを数えるのに読み飛ばすことになる
 * （タスクの完了を末尾に置いているのと同じ扱い）。
 *
 * 「追加順」はNotionが返した順そのもの。並べ替えを掛けないことが追加順になる。
 */
export function sortShoppingItems(items: ShoppingItem[], sort: ShoppingSort): ShoppingItem[] {
  const sorted = [...items];

  if (sort === "name") {
    sorted.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  } else if (sort === "priority") {
    sorted.sort(
      (a, b) =>
        (PRIORITY_ORDER[a.priority ?? ""] ?? SHOPPING_PRIORITIES.length) -
        (PRIORITY_ORDER[b.priority ?? ""] ?? SHOPPING_PRIORITIES.length),
    );
  } else if (sort === "planned") {
    // 予定日を決めていないものは末尾へ送る。日付順で見る理由は「次に買いに行く日のぶんを
    // まとめて読む」ことで、日の決まっていないものが先頭に並ぶとその邪魔になる。
    // 日付は YYYY-MM-DD なので文字列のまま比べられる。
    sorted.sort((a, b) => (a.plannedDate ?? "9999-99-99").localeCompare(b.plannedDate ?? "9999-99-99"));
  }

  // 安定ソートなので、購入済みで分けたあとも上の並びがそのまま残る。
  sorted.sort((a, b) => Number(a.bought) - Number(b.bought));
  return sorted;
}

/**
 * 一覧に並べるカテゴリのキー。
 *
 * 並び順の正はNotionのプロパティ定義（`categories`）。そこに無いカテゴリが項目に付いている
 * ときは末尾へ足す（選択肢の取得に失敗した場合も、項目だけで一覧を組み立てられる）。
 * 未設定の項目があるときだけ「その他」を最後に置く。
 */
export function shoppingCategoryKeys(items: ShoppingItem[], categories: string[]): string[] {
  const keys = categories.filter((name) => name.length > 0);
  const known = new Set(keys);

  for (const item of items) {
    if (item.category && !known.has(item.category)) {
      known.add(item.category);
      keys.push(item.category);
    }
  }

  if (items.some((item) => item.category === null)) keys.push(UNCATEGORIZED_KEY);
  return keys;
}

/** タブに出す未購入の件数。`all` は全カテゴリの合計。 */
export function unboughtCounts(items: ShoppingItem[]): Record<string, number> {
  const counts: Record<string, number> = { all: 0 };
  for (const item of items) {
    if (item.bought) continue;
    counts.all += 1;
    const key = categoryKeyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export type ShoppingSection = {
  key: string;
  label: string;
  items: ShoppingItem[];
};

/**
 * 画面に並べる区分を組み立てる。
 *
 * `filterKey` が `all` のときはカテゴリごとに束ね、カテゴリを選んでいるときはその1つだけを返す
 * （見出しはタブが示しているため、画面側では出さない）。
 *
 * 購入済みを隠しているあいだも、その区分に未購入が1件も無ければ区分ごと出さない。空の見出しが
 * 並ぶと、残っているカテゴリを数えるのに読み飛ばすことになる。
 */
export function buildShoppingSections(
  items: ShoppingItem[],
  categories: string[],
  {
    filterKey,
    sort,
    showBought,
  }: { filterKey: string; sort: ShoppingSort; showBought: boolean },
): ShoppingSection[] {
  const keys =
    filterKey === "all" ? shoppingCategoryKeys(items, categories) : [filterKey];

  return keys
    .map((key) => {
      const inCategory = items.filter((item) => categoryKeyOf(item) === key);
      const visible = showBought ? inCategory : inCategory.filter((item) => !item.bought);
      return { key, label: categoryLabelOf(key), items: sortShoppingItems(visible, sort) };
    })
    .filter((section) => section.items.length > 0);
}

/**
 * 購入予定日の見せ方（`docs/spec.md` §36）。
 *
 * 「今日」「明日」は日付そのものより先に読める言葉にする。買い物リストで決めたいのは
 * 「いま出れば済むか、明日でよいか」で、`9/7` と `9/8` の見分けはその判断より一段遠い。
 * それより先の日は月日で出す（年は出さない。買い物の予定日が年をまたぐことは想定していない）。
 *
 * 今日の日付は必ず呼び出し側から渡す。実行環境のローカル時刻で決めると、サーバー（UTC）と
 * ブラウザ（JST）で「今日」が食い違い、描画が一致しない（CLAUDE.md「日付・時刻の解釈」）。
 */
export type ShoppingDateTone = "past" | "today" | "future";

export function shoppingDateLabel(dateKey: string, todayKey: string): string {
  const diff = dateKeyDiffDays(todayKey, dateKey);
  if (diff === 0) return "今日";
  if (diff === 1) return "明日";

  const [, month, day] = dateKey.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/**
 * 過ぎた予定日は色を分ける。
 *
 * 買うつもりだった日を過ぎても、その日付のまま残す（今日へ繰り上げると、いつ買うつもり
 * だったかが消える）。代わりに、まだ買っていないことがひと目で分かるようにする。
 */
export function shoppingDateTone(dateKey: string, todayKey: string): ShoppingDateTone {
  if (dateKey < todayKey) return "past";
  return dateKey === todayKey ? "today" : "future";
}
