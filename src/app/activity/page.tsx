import Link from "next/link";
import { redirect } from "next/navigation";
import { Timer } from "lucide-react";

import { ActivityScreen } from "@/components/activity/activity-screen";
import { BottomNav } from "@/components/nav/main-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { listActivityPresets } from "@/services/activity/presets";
import { getRunningActivity } from "@/services/activity/running";

export default async function ActivityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // 記録はDaySpanのDBだけで完結する。外部APIには触れないため、開くのに待ち時間は入らない。
  // 保存先の有無はカレンダー設定の行数で見る（Googleへ問い合わせると、押すまでに間が空く）。
  const [presets, running, calendarCount, uiSetting] = await Promise.all([
    listActivityPresets(user.id),
    getRunningActivity(user.id),
    db.calendarSetting.count({ where: { userId: user.id, visible: true } }),
    db.uiSetting.findUnique({ where: { userId: user.id } }),
  ]);

  // 保存先が無いと、止めた記録を予定にできない。押せてしまう前に接続へ誘導する。
  if (calendarCount === 0) return <ConnectPrompt />;

  return (
    <ActivityScreen
      presets={presets}
      initialRunning={running}
      timeZone={uiSetting?.timeZone ?? "Asia/Tokyo"}
    />
  );
}

function ConnectPrompt() {
  return (
    <div className="flex h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
        <div className="flex items-center gap-2 text-xl font-semibold">
          <Timer className="size-6 text-primary" />
          活動記録
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Google Calendarが接続されていません</CardTitle>
            <CardDescription>
              記録した内容はGoogle Calendarの予定として保存されます。先にカレンダーを接続してください。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/settings/google">設定へ</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <BottomNav current="activity" />
    </div>
  );
}
