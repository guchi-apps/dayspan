import Link from "next/link";
import { CalendarDays } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;

  const next =
    callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/calendar";

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6 bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-xl font-semibold">
        <CalendarDays className="size-6 text-primary" />
        DaySpan
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>ログイン</CardTitle>
          <CardDescription>
            Google CalendarとNotionのタスクを1つのカレンダーで確認できます。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error === "not_allowed" && (
            <p className="text-sm text-destructive">
              このGoogleアカウントは利用を許可されていません。
            </p>
          )}
          {error === "auth_failed" && (
            <p className="text-sm text-destructive">
              ログインに失敗しました。時間をおいて再度お試しください。
            </p>
          )}

          {/* スマートフォンでも押しやすい高さにする。既定のボタン高さ(32px)はタップ対象として小さい。 */}
          <Button asChild className="h-11 w-full text-base">
            <Link href={`/auth/signin?next=${encodeURIComponent(next)}`} prefetch={false}>
              Googleでログイン
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
