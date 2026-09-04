import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";

/**
 * 年休の付与日数と年度の開始月を保存する（docs/spec.md §34）。
 *
 * 年度ごとの付与（`AnnualLeaveGrant`）と全年度共通の開始月（`UiSetting.fiscalYearStartMonth`）を
 * ひとつの `PUT` で受ける。画面ではどちらも同じダイアログで直すため、分けると保存の往復が
 * 2回になる。
 *
 * 検証は画面だけでなくここでも行う。DaySpanのAPIや将来のMCPから直接呼ばれた要求は画面を
 * 通らないため（`src/app/api/work/shared.ts` と同じ考え方）。
 */

type Body = {
  fiscalYear?: number;
  grantedDays?: number;
  carriedOverDays?: number;
  fiscalYearStartMonth?: number;
};

/** 付与・繰越として受け付ける日数か。半休が0.5日なので0.5刻みまで受ける。 */
function invalidDays(value: unknown): boolean {
  return (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 400 ||
    Math.round(value * 2) !== value * 2
  );
}

export async function PUT(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Body;
  const { fiscalYear, grantedDays, carriedOverDays, fiscalYearStartMonth } = body;

  // 年度は開始年で持つ。範囲を切るのは、打ち間違い（西暦を1桁多く打つ等）の行がDBへ残ると
  // 画面のどこからも開けない年度になるため。
  if (
    typeof fiscalYear !== "number" ||
    !Number.isInteger(fiscalYear) ||
    fiscalYear < 2000 ||
    fiscalYear > 2100
  ) {
    return NextResponse.json({ error: "fiscalYear must be 2000-2100" }, { status: 400 });
  }
  if (invalidDays(grantedDays) || invalidDays(carriedOverDays)) {
    return NextResponse.json(
      {
        error: "invalid_days",
        message: "付与日数・繰越日数は0〜400の範囲で、0.5日単位で入力してください。",
      },
      { status: 400 },
    );
  }
  if (
    fiscalYearStartMonth !== undefined &&
    (!Number.isInteger(fiscalYearStartMonth) ||
      fiscalYearStartMonth < 1 ||
      fiscalYearStartMonth > 12)
  ) {
    return NextResponse.json({ error: "fiscalYearStartMonth must be 1-12" }, { status: 400 });
  }

  // UiSetting は初回ログイン時には作られていない（画面側が既定値で描いている）。
  // 既存の /api/settings/ui と同じく upsert で受ける。
  await Promise.all([
    db.annualLeaveGrant.upsert({
      where: { userId_fiscalYear: { userId, fiscalYear } },
      create: { userId, fiscalYear, grantedDays: grantedDays!, carriedOverDays: carriedOverDays! },
      update: { grantedDays: grantedDays!, carriedOverDays: carriedOverDays! },
    }),
    fiscalYearStartMonth === undefined
      ? Promise.resolve(null)
      : db.uiSetting.upsert({
          where: { userId },
          create: { userId, fiscalYearStartMonth },
          update: { fiscalYearStartMonth },
        }),
  ]);

  return NextResponse.json({ ok: true });
}
