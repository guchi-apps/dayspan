import Link from "next/link";
import { redirect } from "next/navigation";
import { Briefcase } from "lucide-react";

import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { WorkScreen } from "@/components/work/work-screen";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { externalApiMessage } from "@/lib/api-error";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { createNotionClient } from "@/services/notion/client";
import { loadTagOptions, type TagOption } from "@/services/notion/tag-options";
import {
  listPendingWorkRecords,
  listWorkRecordsInRange,
  workCapabilities,
  workDatabaseReady,
  workTripPlaces,
} from "@/services/notion/work-logs";
import { normalizeWorkMinutes, type WorkRecordItem } from "@/types/work";

/** その月の初日と末日。日付の解釈は設定のタイムゾーンに閉じている（月の境目もそこで決まる）。 */
function monthRange(monthKey: string): { from: string; to: string } {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  // 翌月の0日目＝その月の末日。月ごとの日数を持たずに求められる。
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(lastDay).padStart(2, "0")}` };
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [connection, uiSetting, runningActivity] = await Promise.all([
    db.notionConnection.findUnique({ where: { userId: user.id } }),
    db.uiSetting.findUnique({
      where: { userId: user.id },
      select: { timeZone: true, workMinutesPerDay: true },
    }),
    // ナビの記録の項目へ印を出すためだけに読む（docs/spec.md §27）。
    db.runningActivity.findUnique({ where: { userId: user.id }, select: { id: true } }),
  ]);

  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";
  const todayKey = createCalendarDateUtils(timeZone).todayKey();

  const { month } = await searchParams;
  const monthKey = month && MONTH_KEY.test(month) ? month : todayKey.slice(0, 7);

  // データソースと必須プロパティが揃っていないと、読むことも書くこともできない。
  if (!connection || !workDatabaseReady(connection)) return <ConnectPrompt />;

  const notion = createNotionClient(connection);
  const range = monthRange(monthKey);

  // 月ぶんの記録と、手続きが残っている記録を同時に取りにいく。未対応のものは月の外にも
  // ありうる（先月の出張の事後登録・来月の年休の申請が残っている）ため、月の取得とは別に引く。
  //
  // Notionが失敗しても画面自体は開く。ここで投げるとNext.jsの汎用のエラー画面へ落ち、
  // 何が起きたのかも、月を送り直せることも画面から分からなくなる（issue #402）。
  // 失敗は握りつぶさず、Notionが返したメッセージをそのまま画面へ出す。
  let records: WorkRecordItem[] = [];
  let pending: WorkRecordItem[] = [];
  let placeOptions: TagOption[] | null = null;
  let loadError: string | null = null;

  try {
    [records, pending, placeOptions] = await Promise.all([
      listWorkRecordsInRange(notion, connection, range),
      listPendingWorkRecords(notion, connection),
      loadTagOptions(connection, "work"),
    ]);
  } catch (error) {
    loadError = `勤務記録を取得できませんでした。${externalApiMessage("notion", "勤務記録の取得", error)}`;
  }

  return (
    <WorkScreen
      monthKey={monthKey}
      todayKey={todayKey}
      records={records}
      openTrips={pending.filter((record) => record.businessTrip && !record.annualLeave)}
      openLeaves={pending.filter((record) => record.annualLeave)}
      placeOptions={placeOptions ?? []}
      loadError={loadError}
      tripPlaces={workTripPlaces(connection)}
      capabilities={workCapabilities(connection)}
      activityRunning={runningActivity !== null}
      timeZone={timeZone}
      workMinutesPerDay={normalizeWorkMinutes(uiSetting?.workMinutesPerDay)}
    />
  );
}

/** 勤務記録DBが未設定のとき。何を用意すればここが使えるようになるのかまで出す。 */
function ConnectPrompt() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2 text-xl font-semibold">
        <Briefcase className="size-6 text-primary" />
        勤務
      </div>
      <Card>
        <CardHeader>
          <CardTitle>勤務記録DBが設定されていません</CardTitle>
          <CardDescription>
            勤務場所・出張・年休・会社休業日はNotionのデータベースに記録します。設定のNotion画面で勤務記録DBを選ぶか、
            新しく作成してください。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/settings/notion">設定へ</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
