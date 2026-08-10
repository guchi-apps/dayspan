import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { SETTING_ORDER } from "@/services/google-calendar/settings";

type Body = { googleAccountId?: string; settingIds?: string[] };

/**
 * カレンダーの表示順を並べ替える（docs/spec.md §7）。
 *
 * 「1つ上へ」を差分で送らず、アカウント1つ分の並び全体を受け取って sortOrder を振り直す。
 * 差分だと連続で押したときに前の結果を待たずに次が届き、届いた順で結果が変わるため。
 */
export async function PUT(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Body;
  if (!body.googleAccountId || !Array.isArray(body.settingIds) || body.settingIds.length === 0) {
    return NextResponse.json(
      { error: "googleAccountId and settingIds are required" },
      { status: 400 },
    );
  }

  // 他ユーザー・他アカウントの設定を書き換えられないよう、対象をDB側で絞り直す。
  const settings = await db.calendarSetting.findMany({
    where: { userId, googleAccountId: body.googleAccountId },
    orderBy: SETTING_ORDER,
    select: { id: true },
  });

  const known = new Set(settings.map((setting) => setting.id));
  const requested = [...new Set(body.settingIds)];
  if (requested.some((id) => !known.has(id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // 送られてこなかった設定（Google側で消えたカレンダーや、この画面を開いた後に
  // 増えたカレンダー）は、いまの並びのまま後ろへ送る。並びの一部だけを受け取っても
  // 拒否せずに済ませ、押した並べ替えが黙って消えないようにする。
  const ordered = [...requested, ...settings.map((s) => s.id).filter((id) => !requested.includes(id))];

  await db.$transaction(
    ordered.map((id, index) =>
      db.calendarSetting.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  return NextResponse.json({ settingIds: ordered });
}
