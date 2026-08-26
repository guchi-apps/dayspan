"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import "./globals.css";

import { Button } from "@/components/ui/button";
import { DEFAULT_HOME_PATH } from "@/lib/home-path";

/**
 * ルートレイアウトそのものが失敗したときの面（issue #407）。
 *
 * `error.tsx` はレイアウトの内側にあるため、レイアウト自身で投げた例外は受けられない。
 * ここはレイアウトごと差し替わる最後の受け皿で、`<html>` と `<body>` を自分で描く。
 * その都合で `globals.css` もここで読む（レイアウトの読み込みは効かない）。
 *
 * 書体は読み込まない。ここまで来ている時点で失敗しているのはアプリの根で、そこへ124分割の
 * フォントを足しても伝わる内容は変わらない。端末の既定の書体で日本語は読める。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dayspan] root error:", error);
  }, [error]);

  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full">
        <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background p-6">
          <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-error-container text-on-error-container">
              <AlertTriangle className="size-7" />
            </div>

            <h1 className="type-title-large">DaySpanを表示できませんでした</h1>

            <p className="type-body-medium text-muted-foreground">
              一時的な不具合の可能性があります。もう一度試すか、時間をおいて開き直してください。
            </p>

            {error.digest && (
              <p className="type-body-small text-muted-foreground">エラーID: {error.digest}</p>
            )}
          </div>

          <div className="flex w-full max-w-sm flex-col gap-2">
            <Button onClick={reset}>
              <RefreshCw />
              もう一度試す
            </Button>

            <Button asChild variant="ghost">
              <a href={DEFAULT_HOME_PATH}>記録へ戻る</a>
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
