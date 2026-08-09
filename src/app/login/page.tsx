import { Suspense } from "react";
import { CalendarDays } from "lucide-react";

import { GoogleLoginButton } from "@/components/auth/google-login-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

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
          <Suspense fallback={null}>
            <GoogleLoginButton />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
