import { CalendarDays } from "lucide-react";

import { getCurrentUser } from "@/lib/auth-user";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function CalendarPage() {
  const user = await getCurrentUser();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2 text-xl font-semibold">
        <CalendarDays className="size-6 text-primary" />
        DaySpan
      </div>

      <Card>
        <CardHeader>
          <CardTitle>カレンダー</CardTitle>
          <CardDescription>
            {user?.email ?? "不明なユーザー"} としてログイン中です。
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          月表示・時間グリッドはこれから実装します（docs/spec.md §5・§6）。
        </CardContent>
      </Card>
    </div>
  );
}
