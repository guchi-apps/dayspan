"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useTransition } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  parseDateKey,
  shiftAnchor,
  toDateKey,
  type CalendarView,
} from "@/lib/calendar-range";
import { cn } from "@/lib/utils";
import type { CalendarLoadResult } from "@/types/calendar";

import { createCalendarDateUtils } from "./item-layout";
import { MonthView } from "./month-view";
import { TimeGridView } from "./time-grid-view";

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
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-1 font-semibold">
          <CalendarDays className="size-5 text-primary" />
          <span className="hidden sm:inline">DaySpan</span>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => move(-1)} aria-label="前へ">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => move(1)} aria-label="次へ">
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>
            今日
          </Button>
        </div>

        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {formatRangeLabel(view, anchorKey, days)}
        </span>

        <div className="flex items-center gap-1">
          {VIEW_LABELS.map((item) => (
            <Button
              key={item.view}
              variant={view === item.view ? "secondary" : "ghost"}
              size="sm"
              className={cn(item.desktopOnly && "hidden md:inline-flex")}
              onClick={() => navigate(item.view, anchorKey)}
            >
              {item.label}
            </Button>
          ))}

          <Button
            variant="ghost"
            size="icon"
            disabled={pending}
            aria-label="再取得"
            onClick={() => startTransition(() => router.refresh())}
          >
            <RefreshCw className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" asChild aria-label="設定">
            <Link href="/settings">
              <Settings className="size-4" />
            </Link>
          </Button>
        </div>
      </header>

      {data.errors.length > 0 && (
        <div className="flex flex-col gap-1 border-b bg-destructive/10 px-3 py-2 text-xs">
          {data.errors.map((error) => (
            <span key={`${error.source}-${error.reason}`}>{error.reason}</span>
          ))}
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
        />
      ) : (
        <TimeGridView days={days} events={data.events} tasks={data.tasks} utils={utils} />
      )}
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
