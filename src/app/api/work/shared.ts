import { NextResponse } from "next/server";

import type { WorkWriteInput } from "@/services/notion/work-logs";

/**
 * 勤務記録の入力の検証（docs/spec.md §34）。
 *
 * 画面でも同じ条件で止めているが、DaySpanのAPIや将来のMCPから直接呼ばれた要求は画面を通らない。
 * 作成と更新のどちらの経路でも同じ条件で断る。
 */

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function validateWorkBody(
  body: WorkWriteInput,
  { requireStartDate }: { requireStartDate: boolean },
): NextResponse | null {
  if (requireStartDate && !body.startDate) {
    return NextResponse.json({ error: "startDate is required" }, { status: 400 });
  }
  if (body.startDate !== undefined && !DATE_KEY.test(body.startDate)) {
    return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (body.endDate != null && !DATE_KEY.test(body.endDate)) {
    return NextResponse.json({ error: "endDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (body.startDate && body.endDate && body.endDate < body.startDate) {
    return NextResponse.json(
      { error: "invalid_range", message: "終了日は開始日より後にしてください。" },
      { status: 400 },
    );
  }
  // 日付を動かすときは、開始日も一緒に送ってもらう。終了日だけを受けると、
  // 重なりの判定に使う期間がサーバー側で決まらない。
  if (body.endDate !== undefined && body.startDate === undefined) {
    return NextResponse.json(
      { error: "startDate is required", message: "期間を変えるときは開始日も送ってください。" },
      { status: 400 },
    );
  }
  return null;
}

/**
 * その日にすでに別の記録がある（1日1件）ときの応答。
 * 応答は毎回作る（NextResponseの本文はストリームで、使い回すと2回目が空になる）。
 */
export const dateTaken = () =>
  NextResponse.json(
    {
      error: "date_taken",
      message: "その日にはすでに別の勤務記録があります。既存の記録を直してください。",
    },
    { status: 409 },
  );

/** 勤務記録DB以外のページへの書き込みは、経路によらず断る。 */
export const notEditable = () =>
  NextResponse.json(
    { error: "not_editable", message: "この項目はDaySpanからは変更できません。" },
    { status: 403 },
  );
