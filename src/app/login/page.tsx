import Link from "next/link";
import { CalendarDays } from "lucide-react";

import { ClearOfflineCache } from "@/components/offline/clear-offline-cache";
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
    <div className="flex h-dvh flex-col items-center justify-center gap-8 bg-surface-container-low p-4">
      <ClearOfflineCache />

      <div className="type-headline-small flex items-center gap-2">
        <CalendarDays className="size-7 text-primary" />
        DaySpan
      </div>

      <Card className="w-full max-w-sm bg-surface-container-high">
        <CardHeader>
          <CardTitle>ログイン</CardTitle>
          <CardDescription>
            Google CalendarとNotionのタスクを1つのカレンダーで確認できます。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error === "not_allowed" && (
            <p className="type-body-small rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
              このGoogleアカウントは利用を許可されていません。
            </p>
          )}
          {error === "auth_failed" && (
            <p className="type-body-small rounded-lg bg-error-container/70 px-3 py-2 text-on-error-container">
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
