import { NextResponse } from "next/server";

import { externalApiError } from "@/lib/api-error";
import { requireUserId } from "@/lib/auth-user";
import { createNotionClient } from "@/services/notion/client";
import { getNotionWorkConnection } from "@/services/calendar/write-context";
import { loadTagOptions } from "@/services/notion/tag-options";
import {
  listPendingWorkRecords,
  listWorkRecordsInRange,
  workDatabaseReady,
} from "@/services/notion/work-logs";
import type { WorkMonthData } from "@/types/work";

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/** その月の初日と末日。日付の解釈は設定のタイムゾーンに閉じている（月の境目もそこで決まる）。 */
function monthRange(monthKey: string): { from: string; to: string } {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  // 翌月の0日目＝その月の末日。月ごとの日数を持たずに求められる。
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * 勤務画面の1か月ぶんの内容（issue #974）。
 *
 * 以前は `/work` のページがNotionを待ってから画面を返していたため、月送りは毎回ページ（RSC）の
 * 取り直しになり、Service Workerが保存できず、オフライン・低速時に別の月を開けなかった。
 * 買い物・タスク（issue #724）と同じく一覧をGET APIにして、`public/sw.js` が保存済みへ倒せるようにする。
 *
 * Notionが失敗したときは200で返さず、理由つきのエラーにする。200で返すと、失敗した内容が
 * 保存済みとして次のオフラインに再生される。
 */
export async function GET(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!MONTH_KEY.test(month)) {
    return NextResponse.json({ error: "month is invalid" }, { status: 400 });
  }

  const connection = await getNotionWorkConnection(userId);
  if (!connection || !workDatabaseReady(connection)) {
    return NextResponse.json({ error: "work_database_not_ready" }, { status: 404 });
  }

  try {
    const notion = createNotionClient(connection);

    // 月ぶんの記録と、手続きが残っている記録を同時に取りにいく。未対応のものは月の外にも
    // ありうる（先月の出張の事後登録・来月の年休の申請が残っている）ため、月の取得とは別に引く。
    const [records, pending, placeOptions] = await Promise.all([
      listWorkRecordsInRange(notion, connection, monthRange(month)),
      listPendingWorkRecords(notion, connection),
      loadTagOptions(connection, "work"),
    ]);

    const data: WorkMonthData = {
      records,
      openTrips: pending.filter((record) => record.businessTrip && !record.annualLeave),
      openLeaves: pending.filter((record) => record.annualLeave),
      placeOptions: placeOptions ?? [],
    };
    return NextResponse.json(data);
  } catch (error) {
    return externalApiError("notion", "勤務記録の取得", error);
  }
}
