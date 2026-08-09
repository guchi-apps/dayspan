import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * 設定画面の枠。
 *
 * 設定は一覧から個別の画面へ入る形にしている（すべてを1画面に展開すると、
 * 目当ての項目にたどり着くまで縦に長くスクロールすることになるため）。
 * どの階層にいても戻り先が1つ上に固定されるよう、戻り先はここで受け取る。
 */
export function SettingsShell({
  title,
  description,
  backHref,
  backLabel,
  children,
}: {
  title: string;
  description?: string;
  backHref: string;
  backLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft className="size-4" />
            {backLabel}
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>

      {children}
    </div>
  );
}
