"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { BellRing, Plus, RefreshCw } from "lucide-react";

import { ItemDialog } from "@/components/calendar/item-dialog";
import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { toReminderDraft, type ReminderDraft } from "@/components/calendar/reminder-form";
import { ReminderDetailDialog } from "@/components/calendar/reminder-detail-dialog";
import { BottomNav, HeaderNav } from "@/components/nav/main-nav";
import { TagChip } from "@/components/tags/tag-chip";
import { tagColorOf } from "@/components/tags/tag-color";
import { OfflineNotice } from "@/components/offline/offline-notice";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinearProgress } from "@/components/ui/linear-progress";
import type { TagCatalog } from "@/services/notion/tag-options";
import type { ReminderItem } from "@/types/calendar";

function groupByYear(reminders: ReminderItem[]) {
  const groups = new Map<string, ReminderItem[]>();
  for (const reminder of reminders) {
    const year = reminder.date.slice(0, 4);
    const group = groups.get(year);
    if (group) group.push(reminder);
    else groups.set(year, [reminder]);
  }
  return Array.from(groups.entries());
}

export function ReminderList({
  reminders,
  tagCatalog,
  timeZone,
  loadError,
}: {
  reminders: ReminderItem[];
  /** 登録済みのタグ・種類。色の表示と入力の候補に使う。 */
  tagCatalog: TagCatalog;
  timeZone: string;
  loadError: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<ReminderDraft | null>(null);
  // タップした直後は表示専用画面を開く。編集アイコンを押したときだけ draft へ切り替える。
  const [viewing, setViewing] = useState<ReminderItem | null>(null);

  // オフライン中は書き込みを止める（docs/spec.md §21）。
  const offline = useOffline();
  useReconnectRefresh();

  const sorted = useMemo(() => [...reminders].sort((a, b) => a.date.localeCompare(b.date)), [reminders]);
  const grouped = useMemo(() => groupByYear(sorted), [sorted]);

  const edit = (reminder: ReminderItem) => {
    if (offline) return;
    setViewing(null);
    setDraft(toReminderDraft(reminder, timeZone));
  };

  // 追加の初期値は今日から。実行環境のローカル時刻ではなく設定タイムゾーンで求める。
  const utils = useMemo(() => createCalendarDateUtils(timeZone), [timeZone]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-2 bg-surface-container-low px-2 py-2">
        <div className="flex shrink-0 items-center gap-1 font-semibold">
          <BellRing className="size-5" />
          <span className="hidden lg:inline">DaySpan</span>
        </div>
        <HeaderNav current="reminders" />
        <span className="flex-1" />
        <Button variant="ghost" size="icon" aria-label="再取得" disabled={pending || offline} onClick={() => startTransition(() => router.refresh())}><RefreshCw className="size-4" /></Button>
      </header>
      <LinearProgress active={pending} />
      <OfflineNotice />
      {loadError && <div className="bg-error-container/70 px-3 py-2 text-xs text-on-error-container">{loadError}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24">
        {grouped.map(([year, items]) => (
          <section key={year}>
            <h2 className="sticky top-0 z-10 bg-surface-container-low px-4 py-1.5 type-label-large text-on-surface-variant">{year}年</h2>
            <ul className="divide-y divide-rule">
              {items.map((reminder) => (
                <li key={reminder.id}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 px-4 py-3 text-left"
                    onClick={() => setViewing(reminder)}
                  >
                    <div className="min-w-14 rounded-lg bg-tertiary-container px-2 py-1 text-center text-on-tertiary-container">
                      <div className="text-xs">{Number(reminder.date.slice(5, 7))}月</div>
                      <div className="text-xl font-semibold leading-5">{Number(reminder.date.slice(8, 10))}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="type-body-large">{reminder.title}</div>
                      <div className="type-body-small flex flex-wrap items-center gap-1.5 text-on-surface-variant">
                        <span>{reminder.date.slice(0, 10)}</span>
                        {reminder.annual !== null && <Badge variant="outline">{reminder.annual ? "毎年" : "単発"}</Badge>}
                        {reminder.category && (
                          <TagChip
                            name={reminder.category}
                            color={tagColorOf(tagCatalog.reminder ?? [], reminder.category)}
                          />
                        )}
                        {reminder.memo && <span className="clip-nowrap">{reminder.memo}</span>}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {sorted.length === 0 && !loadError && <p className="p-6 text-center text-sm text-muted-foreground">日付リマインドがありません。</p>}
      </div>

      <Button
        size="icon"
        className="elevation-3 fixed right-4 bottom-[calc(6rem_+_env(safe-area-inset-bottom))] size-14 rounded-lg bg-primary-container text-on-primary-container hover:brightness-95 md:bottom-6"
        aria-label="日付リマインドを追加"
        disabled={offline}
        onClick={() => setDraft({ dateMode: "date", date: utils.todayKey() })}
      >
        <Plus className="size-6" />
      </Button>

      <BottomNav current="reminders" />

      {draft && (
        <ItemDialog
          initialKind="reminder"
          drafts={{ reminder: draft }}
          tagCatalog={tagCatalog}
          timeZone={timeZone}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            startTransition(() => router.refresh());
          }}
        />
      )}

      {viewing && (
        <ReminderDetailDialog
          reminder={viewing}
          categoryOptions={tagCatalog.reminder ?? []}
          timeZone={timeZone}
          readOnly={offline}
          onClose={() => setViewing(null)}
          onEdit={() => edit(viewing)}
          onDeleted={() => {
            setViewing(null);
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}
