"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { weekMonthKey } from "@/lib/calendar-range";
import { cn } from "@/lib/utils";
import type { CalendarEventItem, TaskItem } from "@/types/calendar";

import { eventColors } from "./calendar-color";
import type { CalendarDateUtils } from "./item-layout";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// 週の高さは固定にする。可変にすると、月をまたいで読み込み直したときに
// スクロール位置を同じ場所へ戻せなくなるため。
const WEEK_HEIGHT = 112;

const MAX_ITEMS_PER_DAY = 4;
const MOBILE_MAX_ITEMS = 3;

export function ContinuousMonthView({
  weeks,
  events,
  tasks,
  weekStartsOn,
  utils,
  initialMonth,
  onVisibleMonthChange,
  onSelectDay,
  onOpenEvent,
  onOpenTask,
}: {
  weeks: string[][];
  events: CalendarEventItem[];
  tasks: TaskItem[];
  weekStartsOn: number;
  utils: CalendarDateUtils;
  initialMonth: string;
  onVisibleMonthChange: (monthKey: string) => void;
  onSelectDay: (dateKey: string) => void;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const visibleMonthRef = useRef(initialMonth);
  const [todayKey] = useState(() => utils.todayKey());

  // 初期表示は、指定された月の先頭週に合わせる。
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const target = weeks.findIndex((week) => weekMonthKey(week) === initialMonth);
    if (target >= 0) container.scrollTop = target * WEEK_HEIGHT;
  }, [weeks, initialMonth]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    // 画面の上から1/3の位置にある週を「いま見ている月」とみなす。
    const index = Math.min(
      Math.max(Math.floor((container.scrollTop + container.clientHeight / 3) / WEEK_HEIGHT), 0),
      weeks.length - 1,
    );
    const month = weekMonthKey(weeks[index]);

    // 見出しの更新だけを行う。スクロールを契機に読み込み直すと、開いていたメニューや
    // ダイアログが再描画で閉じてしまい、操作を受け付けていないように見える。
    // 読み込み済みの範囲の外へ行くときは、ヘッダーの前へ・次へで移動する。
    if (month !== visibleMonthRef.current) {
      visibleMonthRef.current = month;
      onVisibleMonthChange(month);
    }
  }, [onVisibleMonthChange, weeks]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-7 border-b border-outline-variant">
        {Array.from({ length: 7 }, (_, index) => {
          const weekday = (weekStartsOn + index) % 7;

          return (
            <div
              key={weekday}
              className={cn(
                "type-label-small py-1.5 text-center",
                weekday === 0
                  ? "text-rose-700/80 dark:text-rose-300/80"
                  : weekday === 6
                    ? "text-sky-700/80 dark:text-sky-300/80"
                    : "text-on-surface-variant",
              )}
            >
              {WEEKDAY_LABELS[weekday]}
            </div>
          );
        })}
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {weeks.map((week) => (
          <div
            key={week[0]}
            className="grid grid-cols-7 border-b border-outline-variant"
            style={{ height: WEEK_HEIGHT }}
          >
            {week.map((dateKey) => {
              const dayEvents = events.filter((event) => utils.eventCoversDay(event, dateKey));
              const dayTasks = tasks.filter((task) => utils.taskCoversDay(task, dateKey));
              const dayItems = [...dayEvents, ...dayTasks].sort(utils.compareItems);

              const visible = dayItems.slice(0, MAX_ITEMS_PER_DAY);
              const hiddenCount = dayItems.length - visible.length;
              const mobileHidden = dayItems.length - MOBILE_MAX_ITEMS;
              const isFirstOfMonth = dateKey.slice(8, 10) === "01";

              return (
                <div
                  key={dateKey}
                  className="flex min-w-0 flex-col gap-0.5 overflow-hidden border-r border-outline-variant p-0.5 last:border-r-0 sm:gap-1 sm:p-1"
                >
                  <button
                    type="button"
                    onClick={() => onSelectDay(dateKey)}
                    className={cn(
                      "grid h-7 min-w-7 shrink-0 place-items-center self-start rounded-full px-2 text-[11px] sm:h-6 sm:min-w-6 sm:px-1.5 sm:text-xs",
                      dateKey === todayKey
                        ? "bg-primary font-semibold text-primary-foreground"
                        : "font-medium hover:bg-muted",
                    )}
                  >
                    {/* 月替わりは日付の並びだけでは分からないため、1日にだけ月を添える。 */}
                    {isFirstOfMonth
                      ? `${Number(dateKey.slice(5, 7))}/1`
                      : Number(dateKey.slice(8, 10))}
                  </button>

                  <div className="flex min-w-0 flex-col gap-px sm:gap-0.5">
                    {visible.map((item, index) =>
                      item.kind === "event" ? (
                        <EventChip
                          key={item.id}
                          event={item}
                          utils={utils}
                          onOpen={() => onOpenEvent(item)}
                          desktopOnly={index >= MOBILE_MAX_ITEMS}
                        />
                      ) : (
                        <TaskChip
                          key={item.id}
                          task={item}
                          utils={utils}
                          onOpen={() => onOpenTask(item)}
                          desktopOnly={index >= MOBILE_MAX_ITEMS}
                        />
                      ),
                    )}

                    {mobileHidden > 0 && (
                      <button
                        type="button"
                        onClick={() => onSelectDay(dateKey)}
                        className="px-0.5 text-left text-[10px] whitespace-nowrap text-on-surface-variant sm:hidden"
                      >
                        +{mobileHidden}
                      </button>
                    )}

                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        onClick={() => onSelectDay(dateKey)}
                        className="hidden truncate px-1 text-left text-[10px] whitespace-nowrap text-on-surface-variant hover:text-foreground sm:block"
                      >
                        ほか {hiddenCount}件
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 予定は占有した時間の「幅」。塗りつぶした帯で表す。 */
function EventChip({
  event,
  utils,
  onOpen,
  desktopOnly,
}: {
  event: CalendarEventItem;
  utils: CalendarDateUtils;
  onOpen: () => void;
  desktopOnly: boolean;
}) {
  const colors = eventColors(event.color);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex h-5 w-full min-w-0 items-center gap-1 overflow-hidden rounded-xs border px-1 text-left text-[10px] leading-5 font-medium sm:type-label-small sm:h-auto sm:px-1 sm:py-px",
        desktopOnly && "hidden sm:flex",
      )}
      style={{
        backgroundColor: colors.background,
        color: colors.foreground,
        borderColor: colors.border,
      }}
      title={event.title}
    >
      {!event.allDay && (
        <span className="hidden shrink-0 opacity-75 sm:inline">
          {utils.formatTime(event.start)}
        </span>
      )}
      <span className="truncate">{event.title}</span>
    </button>
  );
}

/** タスクは期限という「点」。塗らず、先頭に目盛りを立てて予定と描き分ける（docs/spec.md §5）。 */
function TaskChip({
  task,
  utils,
  onOpen,
  desktopOnly,
}: {
  task: TaskItem;
  utils: CalendarDateUtils;
  onOpen: () => void;
  desktopOnly: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex h-5 w-full min-w-0 items-center gap-1 overflow-hidden rounded-xs border border-outline bg-surface-container-lowest px-1 text-left text-[10px] leading-5 font-medium sm:type-label-small sm:h-auto sm:px-1 sm:py-px",
        task.done && "text-on-surface-variant line-through",
        desktopOnly && "hidden sm:flex",
      )}
      title={task.title}
    >
      <span
        aria-hidden
        className={cn(
          "h-2.5 w-0.5 shrink-0",
          task.done ? "bg-on-surface-variant/60" : "bg-primary",
        )}
      />
      {task.hasTime && task.due && (
        <span className="hidden shrink-0 opacity-70 sm:inline">{utils.formatTime(task.due)}</span>
      )}
      <span className="truncate">{task.title}</span>
    </button>
  );
}
