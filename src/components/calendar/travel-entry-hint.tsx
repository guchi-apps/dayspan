"use client";

import { useOffline } from "next/offline";

import { Route } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * 保存先に移動カレンダーを選び直したときに出す、移動の入力への入口（issue #895）。
 *
 * 自動では切り替えない。移動カレンダーへ「予定として」保存する使い方も残すため（docs/spec.md §29）、
 * 乗換案内を貼り付けたい人だけが押す。移動は入力済みのタイトルを使わない（出発地と目的地から
 * 決まる）ことを添える。
 */
export function TravelEntryHint({ onOpen }: { onOpen: () => void }) {
  const offline = useOffline();
  if (offline) return null;

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={onOpen}>
        <Route className="size-4" />
        移動として入力
      </Button>
      <p className="text-xs text-muted-foreground">
        移動の入力に移ります。ここで入れたタイトルは引き継がれません。
      </p>
    </div>
  );
}
