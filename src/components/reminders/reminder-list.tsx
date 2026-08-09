"use client";

import { useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, ExternalLink, RefreshCw } from "lucide-react";

import { BottomNav, HeaderNav } from "@/components/nav/main-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinearProgress } from "@/components/ui/linear-progress";
import type { ReminderItem } from "@/types/calendar";

export function ReminderList({ reminders, loadError }: { reminders: ReminderItem[]; loadError: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const sorted = useMemo(() => [...reminders].sort((a, b) => a.date.localeCompare(b.date)), [reminders]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-2 bg-surface-container-low px-2 py-2">
        <h1 className="type-title-large flex items-center gap-2 px-2"><BellRing className="size-5" /><span className="hidden sm:inline">日付リマインド</span></h1>
        <HeaderNav current="reminders" />
        <span className="flex-1" />
        <Button variant="ghost" size="icon" aria-label="再取得" disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw className="size-4" /></Button>
      </header>
      <LinearProgress active={pending} />
      {loadError && <div className="bg-error-container/70 px-3 py-2 text-xs text-on-error-container">{loadError}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24">
        <ul className="divide-y divide-rule">
          {sorted.map((reminder) => (
            <li key={reminder.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-14 rounded-lg bg-tertiary-container px-2 py-1 text-center text-on-tertiary-container">
                <div className="text-xs">{Number(reminder.date.slice(5, 7))}月</div>
                <div className="text-xl font-semibold leading-5">{Number(reminder.date.slice(8, 10))}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="type-body-large">{reminder.title}</div>
                <div className="type-body-small flex flex-wrap items-center gap-1.5 text-on-surface-variant">
                  <span>{reminder.date.slice(0, 10)}</span>
                  {reminder.category && <Badge variant="secondary">{reminder.category}</Badge>}
                  {reminder.memo && <span className="clip-nowrap">{reminder.memo}</span>}
                </div>
              </div>
              {reminder.url && <Button asChild variant="ghost" size="icon"><a href={reminder.url} target="_blank" rel="noreferrer" aria-label="Notionで開く"><ExternalLink className="size-4" /></a></Button>}
            </li>
          ))}
        </ul>
        {sorted.length === 0 && !loadError && <p className="p-6 text-center text-sm text-muted-foreground">日付リマインドがありません。</p>}
      </div>
      <BottomNav current="reminders" />
    </div>
  );
}
