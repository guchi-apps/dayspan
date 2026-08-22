import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";

import { CalendarShell } from "@/components/calendar/calendar-shell";
import { AppBadgeSync } from "@/components/notifications/app-badge-sync";
import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth-user";
import {
  getContinuousMonthWeeks,
  getMonthsFetchRange,
  getSwipeFetchRange,
  getVisibleDays,
  monthsOfWeeks,
  parseDateKey,
  parseView,
  toDateKey,
} from "@/lib/calendar-range";
import { CALENDAR_VIEW_COOKIE, parseCalendarMemory } from "@/lib/calendar-view-memory";
import { db } from "@/lib/db";
import { getRunningActivity } from "@/services/activity/running";
import { listActivityCalendarIds } from "@/services/activity/settings";
import { loadCalendarData } from "@/services/calendar/load";
import { loadPlaceCatalog } from "@/services/notion/places";
import { loadTagCatalog } from "@/services/notion/tag-options";
import { getTravelSettings } from "@/services/travel/settings";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;

  // 前回この端末で見ていた表示形式・日付（issue #279）。URLに書かれている項目のほうが常に優先で、
  // 書かれていない項目だけをここで埋める。再読み込み・ブックマーク・共有されたURLの意味を変えないため。
  // 記憶が無い・古い（Cookieの期限切れ）ときは、今日の月表示になる。
  const memory = parseCalendarMemory((await cookies()).get(CALENDAR_VIEW_COOKIE)?.value);
  const view = parseView(params.view ?? memory?.view);

  const [uiSetting, googleAccountCount, notionConnection] = await Promise.all([
    db.uiSetting.findUnique({ where: { userId: user.id } }),
    db.googleAccount.count({ where: { userId: user.id } }),
    db.notionConnection.findUnique({ where: { userId: user.id } }),
  ]);

  const timeZone = uiSetting?.timeZone ?? "Asia/Tokyo";

  // URLにも記憶にも日付が無いときの「今日」は、設定タイムゾーンで決める。サーバー（VPS）の
  // ローカル時刻はUTCのため、new Date() 任せにすると日本時間の 00:00〜09:00 が前日になる。
  const anchor = parseDateKey(
    params.date ?? memory?.dateKey ?? createCalendarDateUtils(timeZone).todayKey(),
  );

  // どちらも未接続の状態でカレンダーだけ出しても何も表示されないため、設定へ誘導する。
  if (googleAccountCount === 0 && !notionConnection?.taskDataSourceId && !notionConnection?.reminderDataSourceId) {
    return <ConnectPrompt />;
  }

  const weekStartsOn = uiSetting?.weekStartsOn ?? 0;

  // 月表示は上下に連続してスクロールするため、前後の月まで含めて取得する。
  const { days, weeks } =
    view === "month"
      ? getContinuousMonthWeeks(anchor, weekStartsOn)
      : getVisibleDays(view, anchor, weekStartsOn);

  // 月表示は月まるごとを1単位として保持する（use-calendar-chunks.ts）。ここで表示される日
  // ちょうどを取ると、端の月が「一部しか無いのに取得済み」になり、あとで窓がずれたときに
  // その月の前半が空欄のまま残る。境界を月に合わせて取る。
  // 日表示は左右スワイプで前後の期間へ移動する。指に追従して隣の期間を描くため、
  // 表示中の期間だけでなく前後1期間ぶんもここで取っておく（calendar-range.ts）。
  const range =
    view === "month"
      ? getMonthsFetchRange(monthsOfWeeks(weeks))
      : getSwipeFetchRange(view, anchor, weekStartsOn);

  // ここでawaitしない。渡した先の<Suspense>境界で解決させ、ヘッダーは取得を待たずに描く。
  const dataPromise = loadCalendarData(user.id, range);

  // タグ・種類は月をまたいでも変わらない。予定・タスクの取得とは分けて解決させ、
  // 月を送るたびにNotionへの往復が増えないようにする。
  const tagCatalogPromise = loadTagCatalog(notionConnection);

  // 場所も月をまたいでは変わらない。予定・タスクの取得とは分けて解決させる。
  const placeCatalogPromise = loadPlaceCatalog(notionConnection);

  // 記録中の活動（docs/spec.md §27）。まだGoogleに予定が無いぶんを時間グリッドへ帯として描く。
  // 活動記録の保存先カレンダーは、記録から作られた予定を描き分けるのに使う（issue #241）。
  // どちらもDaySpanのDBだけで完結するため、外部APIを待たずにここで解決しておく。
  // 移動の既定値（docs/spec.md §29）も同じくDaySpanのDBだけで完結する。
  // 予定から移動を足すときの初期値に使うため、画面と一緒に渡しておく。
  const [runningActivity, activityCalendarIds, travelSettings] = await Promise.all([
    getRunningActivity(user.id),
    listActivityCalendarIds(user.id),
    getTravelSettings(user.id),
  ]);

  return (
    <>
      {/* バッジの件数は期限が今日以前のタスク（docs/spec.md §32）。カレンダーが取っているのは
          表示中の期間ぶんだけで、期限切れがその外にあると数が合わない。この画面では取り直す。 */}
      <AppBadgeSync />
      <CalendarShell
        view={view}
        anchorKey={toDateKey(anchor)}
        days={days}
        weeks={weeks}
        dataPromise={dataPromise}
        tagCatalogPromise={tagCatalogPromise}
        placeCatalogPromise={placeCatalogPromise}
        initialRunningActivity={runningActivity}
        activityCalendarIds={activityCalendarIds}
        travelSettings={travelSettings}
        weekStartsOn={weekStartsOn}
        timeZone={timeZone}
        autoRefreshSeconds={uiSetting?.autoRefreshSeconds ?? 300}
      />
    </>
  );
}

function ConnectPrompt() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2 text-xl font-semibold">
        <CalendarDays className="size-6 text-primary" />
        DaySpan
      </div>

      <Card>
        <CardHeader>
          <CardTitle>まだ何も接続されていません</CardTitle>
          <CardDescription>
            Google CalendarとNotionを接続すると、予定とタスクがここに表示されます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/settings">設定へ</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
