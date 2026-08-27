import { NextResponse } from "next/server";

import type { ShoppingWriteInput } from "@/services/notion/shopping-items";
import { SHOPPING_PRIORITIES } from "@/types/shopping";

/**
 * 買い物リストの入力の検証（docs/spec.md §36）。
 *
 * 画面でも同じ条件で止めているが、DaySpanのAPIや将来のMCPから直接呼ばれた要求は画面を通らない。
 * 作成と更新のどちらの経路でも同じ条件で断る。
 */

/** Notionのタイトル・rich_textはこの長さまで。超えるとNotionが400を返す。 */
const TEXT_LIMIT = 2000;

export function validateShoppingBody(
  body: ShoppingWriteInput,
  { requireName }: { requireName: boolean },
): NextResponse | null {
  if (requireName && !body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (body.name !== undefined && !body.name.trim()) {
    return NextResponse.json(
      { error: "name is required", message: "アイテム名を入力してください。" },
      { status: 400 },
    );
  }
  if (body.name !== undefined && body.name.length > TEXT_LIMIT) {
    return NextResponse.json({ error: "name is too long" }, { status: 400 });
  }
  if (body.memo != null && body.memo.length > TEXT_LIMIT) {
    return NextResponse.json({ error: "memo is too long" }, { status: 400 });
  }
  // 優先度はDaySpanが決めた3つだけ。Notionのselectは定義に無い名前を書き込むとその場で
  // 選択肢が増えるため、知らない名前を素通りさせると、行左端の帯の色も並び順も決まらない
  // 選択肢がNotion側に残る。
  if (
    body.priority != null &&
    !(SHOPPING_PRIORITIES as readonly string[]).includes(body.priority)
  ) {
    return NextResponse.json(
      {
        error: "invalid_priority",
        message: `優先度は${SHOPPING_PRIORITIES.join("・")}のいずれかにしてください。`,
      },
      { status: 400 },
    );
  }
  return null;
}

/** 買い物リストDB以外のページへの書き込みは、経路によらず断る。 */
export const notEditable = () =>
  NextResponse.json(
    { error: "not_editable", message: "この項目はDaySpanからは変更できません。" },
    { status: 403 },
  );
