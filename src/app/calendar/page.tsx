import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";

import { CalendarShell } from "@/components/calendar/calendar-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth-user";
import {
  getContinuousMonthWeeks,
  getFetchRange,
  getVisibleDays,
  parseDateKey,
  parseView,
  toDateKey,
} from "@/lib/calendar-range";
import { db } from "@/lib/db";
import { loadCalendarData } from "@/services/calendar/load";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const view = parseView(params.view);
  const anchor = parseDateKey(params.date);

  const [uiSetting, googleAccountCount, notionConnection] = await Promise.all([
    db.uiSetting.findUnique({ where: { userId: user.id } }),
    db.googleAccount.count({ where: { userId: user.id } }),
    db.notionConnection.findUnique({ where: { userId: user.id } }),
  ]);

  // どちらも未接続の状態でカレンダーだけ出しても何も表示されないため、設定へ誘導する。
  if (googleAccountCount === 0 && !notionConnection?.taskDataSourceId) {
    return <ConnectPrompt />;
  }

  const weekStartsOn = uiSetting?.weekStartsOn ?? 0;

  // 月表示は上下に連続してスクロールするため、前後の月まで含めて取得する。
  const { days, weeks } =
    view === "month"
      ? getContinuousMonthWeeks(anchor, weekStartsOn)
      : getVisibleDays(view, anchor, weekStartsOn);

  const data = await loadCalendarData(user.id, getFetchRange(days));

  return (
    <CalendarShell
      view={view}
      anchorKey={toDateKey(anchor)}
      days={days}
      weeks={weeks}
      data={data}
      weekStartsOn={weekStartsOn}
      timeZone={uiSetting?.timeZone ?? "Asia/Tokyo"}
    />
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
