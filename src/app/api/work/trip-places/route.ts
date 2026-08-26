import { NextResponse } from "next/server";

import { requireUserId } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { workCapabilities } from "@/services/notion/work-logs";

type Body = { places?: unknown };

/**
 * 出張扱いにする勤務場所を決める（docs/spec.md §34）。
 *
 * 保存するのは勤務場所の名前だけで、Notion側へは何も書かない（選択肢そのものはNotionの
 * プロパティ定義が一次情報源で、DaySpanが持つのは「どれを出張と見なすか」だけ）。
 * 送られてきた一覧でまるごと置き換える。1件ずつの追加・削除にすると、画面で複数を切り替えた
 * ときに順番次第で結果が変わる。
 */
export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const connection = await db.notionConnection.findUnique({ where: { userId } });
  if (!connection?.workDataSourceId) {
    return NextResponse.json({ error: "work_database_not_selected" }, { status: 404 });
  }

  // 出張のチェックを持たないDBでは、出張扱いにしても書き込む先が無い。画面でも出さないが、
  // DaySpanのAPIや将来のMCPから直接呼ばれた要求は画面を通らないため、ここでも断る。
  if (!workCapabilities(connection).businessTrip) {
    return NextResponse.json(
      {
        error: "business_trip_property_missing",
        message: "勤務記録DBに出張（チェックボックス）のプロパティがありません。",
      },
      { status: 422 },
    );
  }

  const { places } = (await request.json()) as Body;
  if (!Array.isArray(places) || places.some((place) => typeof place !== "string")) {
    return NextResponse.json({ error: "places must be an array of strings" }, { status: 400 });
  }

  // 同じ名前が2つ入っていても意味は変わらないが、画面へ返す一覧が重複したまま増え続ける。
  const normalized = [...new Set((places as string[]).map((place) => place.trim()).filter(Boolean))];

  await db.notionConnection.update({
    where: { userId },
    data: { workTripPlaces: normalized },
  });

  return NextResponse.json({ places: normalized });
}
