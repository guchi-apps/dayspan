"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw, Settings } from "lucide-react";

import { BottomNav, HeaderNav } from "@/components/nav/main-nav";
import { Button } from "@/components/ui/button";
import {
  parseDateKey,
  shiftAnchor,
  toDateKey,
  type CalendarView,
} from "@/lib/calendar-range";
import { cn } from "@/lib/utils";
import type { CalendarEventItem, CalendarLoadResult, TaskItem } from "@/types/calendar";

import { dateKeyPlusMinutes, localInputToIso } from "./datetime-fields";
import { EventDialog, toEventDraft, type EventDraft } from "./event-dialog";
import { createCalendarDateUtils } from "./item-layout";
import { MonthView } from "./month-view";
import { TaskDialog, toTaskDraft, type TaskDraft } from "./task-dialog";
import { TimeGridView } from "./time-grid-view";
import type { AllDayDragCommit, DragCommit } from "./use-grid-drag";

const VIEW_LABELS: { view: CalendarView; label: string; desktopOnly?: boolean }[] = [
  { view: "month", label: "月" },
  { view: "day1", label: "1日" },
  { view: "day3", label: "3日", desktopOnly: true },
  { view: "day7", label: "7日", desktopOnly: true },
];

export function CalendarShell({
  view,
  anchorKey,
  days,
  weeks,
  data,
  weekStartsOn,
  timeZone,
}: {
  view: CalendarView;
  anchorKey: string;
  days: string[];
  weeks: string[][];
  data: CalendarLoadResult;
  weekStartsOn: number;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const utils = useMemo(() => createCalendarDateUtils(timeZone), [timeZone]);

  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const closeDialogs = () => {
    setEventDraft(null);
    setTaskDraft(null);
  };

  const handleSaved = () => {
    closeDialogs();
    startTransition(() => router.refresh());
  };

  const [dragError, setDragError] = useState<string | null>(null);

  /**
   * ドラッグで変わった時刻を保存する。失敗しても画面の見た目は元へ戻す（再取得する）ので、
   * 保存できたつもりのまま作業が進まないようにする。
   */
  const commitDrag = async (commit: DragCommit) => {
    setDragError(null);

    const startIso = localInputToIso(dateKeyPlusMinutes(commit.dayKey, commit.startMinutes), timeZone);

    try {
      let response: Response;

      if (commit.target.kind === "event") {
        const event = commit.target.item;
        response = await fetch(`/api/events/${encodeURIComponent(event.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            calendarId: event.calendarId,
            title: event.title,
            allDay: false,
            start: startIso,
            end: localInputToIso(
              dateKeyPlusMinutes(commit.dayKey, commit.endMinutes),
              timeZone,
            ),
          }),
        });
      } else {
        response = await fetch(`/api/tasks/${encodeURIComponent(commit.target.item.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ due: startIso }),
        });
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setDragError(body?.message ?? "変更を保存できませんでした。");
      }
    } catch {
      setDragError("変更を保存できませんでした。");
    } finally {
      startTransition(() => router.refresh());
    }
  };

  /** 終日エリアのドラッグ。動かせるのは日付だけなので、日数分ずらして保存する。 */
  const commitAllDayDrag = async (commit: AllDayDragCommit) => {
    setDragError(null);

    try {
      let response: Response;

      if (commit.target.kind === "event") {
        const event = commit.target.item;
        response = await fetch(`/api/events/${encodeURIComponent(event.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            calendarId: event.calendarId,
            title: event.title,
            allDay: true,
            start: shiftDateKey(event.start, commit.deltaDays),
            end: shiftDateKey(event.end, commit.deltaDays),
          }),
        });
      } else {
        response = await fetch(`/api/tasks/${encodeURIComponent(commit.target.item.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ due: commit.dayKey }),
        });
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setDragError(body?.message ?? "変更を保存できませんでした。");
      }
    } catch {
      setDragError("変更を保存できませんでした。");
    } finally {
      startTransition(() => router.refresh());
    }
  };

  const openEvent = (event: CalendarEventItem) => setEventDraft(toEventDraft(event, timeZone));
  const openTask = (task: TaskItem) => setTaskDraft(toTaskDraft(task, timeZone));

  /** 新規作成の初期値。時間グリッドの空き時間を選んだ場合はその日時から1時間で開く。 */
  const newEventDraft = (dateKey: string, minutes: number | null): EventDraft => {
    if (minutes === null) {
      return { allDay: true, start: dateKey, end: dateKey };
    }
    return {
      allDay: false,
      start: dateKeyPlusMinutes(dateKey, minutes),
      end: dateKeyPlusMinutes(dateKey, Math.min(minutes + 60, 23 * 60 + 30)),
    };
  };

  const navigate = (nextView: CalendarView, nextAnchorKey: string) => {
    startTransition(() => {
      router.push(`/calendar?view=${nextView}&date=${nextAnchorKey}`);
    });
  };

  const move = (direction: 1 | -1) => {
    navigate(view, toDateKey(shiftAnchor(view, parseDateKey(anchorKey), direction)));
  };

  const goToday = () => {
    navigate(view, utils.todayKey());
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-1 bg-surface-container-low px-1 py-1.5 md:gap-2 md:px-2 md:py-2">
        {/* 狭い画面ではアプリ名を出さない。現在地は下部のナビゲーションバーが示している。 */}
        <div className="hidden items-center gap-1 font-semibold md:flex">
          <CalendarDays className="size-5" />
          <span className="hidden lg:inline">DaySpan</span>
        </div>

        <HeaderNav current="calendar" />

        <div className="flex items-center">
          <Button variant="ghost" size="icon-sm" onClick={() => move(-1)} aria-label="前へ">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => move(1)} aria-label="次へ">
            <ChevronRight className="size-4" />
          </Button>
        </div>

        {/* どの期間を見ているかは常に読めなければならない。他の操作より優先して幅を与える。 */}
        <h1 className="type-title-medium md:type-title-large min-w-0 flex-1 truncate">
          {formatRangeLabel(view, anchorKey, days)}
        </h1>

        <Button variant="outline" size="xs" className="md:h-8 md:px-4" onClick={goToday}>
          今日
        </Button>

        {/* M3のセグメンテッドボタン。排他的な選択であることを、隣接した枠で示す。 */}
        <div className="flex items-center overflow-hidden rounded-full border border-outline">
          {VIEW_LABELS.map((item) => (
            <Button
              key={item.view}
              variant={view === item.view ? "secondary" : "ghost"}
              size="xs"
              className={cn(
                "type-label-medium h-7 rounded-none px-2.5 md:type-label-large md:h-8 md:px-3",
                view === item.view && "text-on-secondary-container",
                item.desktopOnly && "hidden md:inline-flex",
              )}
              onClick={() => navigate(item.view, anchorKey)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          disabled={pending}
          aria-label="再取得"
          onClick={() => startTransition(() => router.refresh())}
        >
          <RefreshCw className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" asChild aria-label="設定" className="hidden md:inline-flex">
          <Link href="/settings">
            <Settings className="size-4" />
          </Link>
        </Button>
      </header>

      {(data.errors.length > 0 || dragError) && (
        <div className="flex flex-col gap-1 bg-error-container/70 text-on-error-container px-3 py-2 text-xs">
          {data.errors.map((error) => (
            <span key={`${error.source}-${error.reason}`}>{error.reason}</span>
          ))}
          {dragError && <span>{dragError}</span>}
        </div>
      )}

      {view === "month" ? (
        <MonthView
          weeks={weeks}
          anchorMonth={anchorKey.slice(0, 7)}
          events={data.events}
          tasks={data.tasks}
          weekStartsOn={weekStartsOn}
          utils={utils}
          onSelectDay={(dateKey) => navigate("day1", dateKey)}
          onOpenEvent={openEvent}
          onOpenTask={openTask}
        />
      ) : (
        <TimeGridView
          days={days}
          events={data.events}
          tasks={data.tasks}
          utils={utils}
          onOpenEvent={openEvent}
          onOpenTask={openTask}
          onSelectSlot={(dateKey, minutes) => setEventDraft(newEventDraft(dateKey, minutes))}
          onDragCommit={commitDrag}
          onAllDayDragCommit={commitAllDayDrag}
        />
      )}

      <BottomNav current="calendar" />

      <AddButton
        open={addMenuOpen}
        canAddEvent={data.calendars.length > 0}
        canAddTask={data.notionReady}
        onToggle={() => setAddMenuOpen((prev) => !prev)}
        onAddEvent={() => {
          setAddMenuOpen(false);
          setEventDraft(newEventDraft(days[0], 9 * 60));
        }}
        onAddTask={() => {
          setAddMenuOpen(false);
          setTaskDraft({ dueMode: "datetime", due: dateKeyPlusMinutes(days[0], 18 * 60) });
        }}
      />

      {eventDraft && (
        <EventDialog
          draft={eventDraft}
          calendars={data.calendars}
          timeZone={timeZone}
          onClose={closeDialogs}
          onSaved={handleSaved}
        />
      )}

      {taskDraft && (
        <TaskDialog
          draft={taskDraft}
          timeZone={timeZone}
          onClose={closeDialogs}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

/** YYYY-MM-DD を日数分ずらす。UTC正午で扱い、タイムゾーンによる日付ずれを避ける。 */
function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 画面右下の「＋」。押すと予定とタスクのどちらを追加するか選ぶ（docs/spec.md §15）。 */
function AddButton({
  open,
  canAddEvent,
  canAddTask,
  onToggle,
  onAddEvent,
  onAddTask,
}: {
  open: boolean;
  canAddEvent: boolean;
  canAddTask: boolean;
  onToggle: () => void;
  onAddEvent: () => void;
  onAddTask: () => void;
}) {
  if (!canAddEvent && !canAddTask) return null;

  return (
    <div className="fixed right-4 bottom-24 z-30 flex flex-col items-end gap-2 md:bottom-6">
      {open && (
        <div className="flex flex-col gap-2">
          {canAddEvent && (
            <Button
              size="sm"
              variant="secondary"
              className="elevation-2 rounded-lg"
              onClick={onAddEvent}
            >
              予定を追加
            </Button>
          )}
          {canAddTask && (
            <Button
              size="sm"
              variant="secondary"
              className="elevation-2 rounded-lg"
              onClick={onAddTask}
            >
              タスクを追加
            </Button>
          )}
        </div>
      )}

      {/* M3のFAB。角は完全な丸ではなく大きめの角丸で、面として置かれていることを示す。 */}
      <Button
        size="icon"
        aria-expanded={open}
        aria-label="追加"
        className="elevation-3 size-14 rounded-lg bg-primary-container text-on-primary-container hover:brightness-95"
        onClick={onToggle}
      >
        <Plus className={cn("size-6 transition-transform", open && "rotate-45")} />
      </Button>
    </div>
  );
}

function formatRangeLabel(view: CalendarView, anchorKey: string, days: string[]): string {
  if (view === "month") {
    return `${anchorKey.slice(0, 4)}年${Number(anchorKey.slice(5, 7))}月`;
  }

  const first = days[0];
  const last = days[days.length - 1];

  if (first === last) {
    return `${first.slice(0, 4)}年${Number(first.slice(5, 7))}月${Number(first.slice(8, 10))}日`;
  }

  return `${first.slice(0, 4)}年${Number(first.slice(5, 7))}月${Number(first.slice(8, 10))}日 – ${Number(last.slice(5, 7))}月${Number(last.slice(8, 10))}日`;
}
