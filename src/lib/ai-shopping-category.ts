// 買い物リストのアイテム名からカテゴリをJevで判定する（issue #725・docs/spec.md §36）。

import { askChoice, type ChoiceQuestion } from "@/lib/typesafe-system-one";

/** Jevは必ずどれかを選ぶため、どれにも当てはまらないときの逃げ道を選択肢へ加える。 */
export const NO_MATCH_LABEL = "（どれにも当てはまらない）";

/** 1回に送るカテゴリの上限。売り場の分類がこれを超えることは想定しない。 */
export const MAX_CATEGORIES = 50;

export function buildShoppingCategoryQuestion(categories: readonly string[]): ChoiceQuestion {
  const criteria: Record<string, string | null> = {};
  for (const name of categories) criteria[name] = null;
  criteria[NO_MATCH_LABEL] = "どのカテゴリにも当てはまらない、または何の商品か判断できない";

  return {
    type: "choice",
    instructions: "買い物リストに入れる商品名から、スーパー・ドラッグストアなどの売り場に当たるカテゴリを1つ選ぶ。",
    criteria,
  };
}

/** 答えが送った一覧に含まれるときだけ採る。逃げ道・一覧外は null。 */
export function pickShoppingCategory(choice: string | null, categories: readonly string[]): string | null {
  if (!choice || choice === NO_MATCH_LABEL) return null;
  return categories.includes(choice) ? choice : null;
}

/** 判定できなかった（通信失敗・応答不正）ときは null。合うものが無いときは `{ category: null }`。 */
export async function suggestShoppingCategory(input: {
  name: string;
  categories: readonly string[];
}): Promise<{ category: string | null } | null> {
  const choice = await askChoice({
    feature: "shopping-category-suggest",
    state: input.name,
    question: buildShoppingCategoryQuestion(input.categories),
  });
  if (choice === null) return null;
  return { category: pickShoppingCategory(choice, input.categories) };
}

/**
 * アイテム名の入力が終わったとき（欄からフォーカスが外れたとき）に自動で判定するか。
 *
 * 選んであるカテゴリ（編集で既に付いているものを含む）は上書きしない。同じ名前では呼び直さない。
 */
export function shouldAutoPickCategory(state: {
  name: string;
  category: string | null;
  lastAskedName: string | null;
  categoryCount: number;
  offline: boolean;
}): boolean {
  const name = state.name.trim();
  return (
    name !== "" &&
    state.category === null &&
    state.lastAskedName !== name &&
    state.categoryCount > 0 &&
    !state.offline
  );
}
