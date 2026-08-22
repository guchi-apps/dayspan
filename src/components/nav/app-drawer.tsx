"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, History, Menu, Settings } from "lucide-react";

import { isPlainClick, useOfflineNavigate } from "@/components/nav/offline-navigate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { APP_VERSION } from "@/lib/app-version";
import { cn } from "@/lib/utils";

/**
 * ヘッダー左上のメニューボタンと、そこから左端に出るドロワー（issue #328）。
 *
 * 下部ナビの5枠はカレンダー・タスク・記録・日付・買い物リストで埋まる。設定は毎日押すもの
 * ではないため枠を1つ占め続ける理由が無く、ここへ移した。
 *
 * スマートフォンだけに出す。PCは下部ナビを持たず、ヘッダー内のナビと歯車から設定へ入れる。
 */
export function AppMenuButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const navigateOffline = useOfflineNavigate();

  // ドロワーの行はソフトナビゲーションで移動する。オフラインでは保存済みがあれば
  // ハードナビゲーションへ切り替える（issue #321。メインナビの項目と同じ扱い）。
  const handleClick = (href: string) => (event: React.MouseEvent) => {
    setOpen(false);
    if (isPlainClick(event) && navigateOffline(href)) event.preventDefault();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="メニュー"
          className={cn("shrink-0 md:hidden", className)}
        >
          <Menu />
        </Button>
      </DialogTrigger>

      <DialogContent
        position="left"
        showCloseButton={false}
        className="bg-surface-container-low pt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
      >
        <DialogTitle className="px-6 pb-3 text-base font-semibold">DaySpan</DialogTitle>
        {/* 読み上げ用。見出しだけでは、ここが何の一覧なのかが読み上げでは伝わらない。 */}
        <DialogDescription className="sr-only">設定とバージョン</DialogDescription>

        <nav className="flex flex-col">
          <DrawerItem
            href="/settings"
            icon={Settings}
            label="設定"
            onClick={handleClick("/settings")}
          />
        </nav>

        {/*
          バージョンはいちばん下に置く。押すとその版で何が変わったかを読める場所（更新履歴）へ入る。
          数字だけを出しても、変わった中身は結局設定から探すことになるため。
        */}
        <Link
          href="/settings/changelog"
          onClick={handleClick("/settings/changelog")}
          className="mt-auto flex items-center gap-2 border-t border-outline-variant px-6 pt-3 text-on-surface-variant transition-colors hover:bg-on-surface/8"
        >
          <History className="size-4 shrink-0" />
          <span className="type-body-small flex-1">v{APP_VERSION}</span>
          <span className="type-body-small">更新履歴</span>
          <ChevronRight className="size-4 shrink-0" />
        </Link>
      </DialogContent>
    </Dialog>
  );
}

/** ドロワーの1行。押す対象は文字幅ではなく行の高さで確保する（設定画面の一覧と同じ）。 */
function DrawerItem({
  href,
  icon: Icon,
  label,
  onClick,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: (event: React.MouseEvent) => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="mx-3 flex items-center gap-3 rounded-full px-4 py-3 text-on-surface transition-colors hover:bg-on-surface/8"
    >
      <Icon className="size-5 shrink-0 text-on-surface-variant" />
      <span className="type-body-large">{label}</span>
    </Link>
  );
}
