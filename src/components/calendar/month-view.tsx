"use client";

import { cn } from "@/lib/utils";
import type { CalendarEventItem, TaskItem } from "@/types/calendar";
import type { CalendarEventItem as EventItem, TaskItem as Task } from "@/types/calendar";

import { eventColors } from "./calendar-color";
import type { CalendarDateUtils } from "./item-layout";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// 1日のマスに詰め込みすぎると月全体が読めなくなるため、上限を超えた分は件数で畳む。
const MAX_ITEMS_PER_DAY = 4;

// 狭い画面は帯と点で示すため、文字を出す場合より多く並べられる。
const MOBILE_MAX_BARS = 4;
const MOBILE_MAX_DOTS = 5;

function mobileHiddenCount(eventCount: number, taskCount: number): number {
  return (
    Math.max(eventCount - MOBILE_MAX_BARS, 0) + Math.max(taskCount - MOBILE_MAX_DOTS, 0)
  );
}

export function MonthView({
  weeks,
  anchorMonth,
  events,
  tasks,
  onSelectDay,
  onOpenEvent,
  onOpenTask,
  weekStartsOn,
  utils,
}: {
  weeks: string[][];
  anchorMonth: string;
  events: CalendarEventItem[];
  tasks: TaskItem[];
  onSelectDay: (dateKey: string) => void;
  onOpenEvent: (event: EventItem) => void;
  onOpenTask: (task: Task) => void;
  weekStartsOn: number;
  utils: CalendarDateUtils;
}) {
  const todayKey = utils.todayKey();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b border-outline-variant">
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

      <div className="grid min-h-0 flex-1 grid-rows-6">
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7 border-b border-outline-variant last:border-b-0">
            {week.map((dateKey) => {
              const dayEvents = events.filter((event) => utils.eventCoversDay(event, dateKey));
              const dayTasks = tasks.filter((task) => utils.taskCoversDay(task, dateKey));
              const dayItems = [...dayEvents, ...dayTasks].sort(utils.compareItems);

              const visible = dayItems.slice(0, MAX_ITEMS_PER_DAY);
              const hiddenCount = dayItems.length - visible.length;
              const inMonth = dateKey.slice(0, 7) === anchorMonth;
              const isToday = dateKey === todayKey;

              return (
                <div
                  key={dateKey}
                  className={cn(
                    "flex min-w-0 flex-col gap-0.5 overflow-hidden border-r border-outline-variant p-0.5 last:border-r-0 sm:gap-1 sm:p-1",
                    !inMonth && "bg-surface-container-low",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectDay(dateKey)}
                    className={cn(
                      "grid size-5 shrink-0 place-items-center self-start rounded-full text-[11px] sm:size-6 sm:text-xs",
                      isToday
                        ? "bg-primary font-semibold text-primary-foreground"
                        : inMonth
                          ? "font-medium hover:bg-muted"
                          : "text-on-surface-variant hover:bg-muted",
                    )}
                  >
                    {Number(dateKey.slice(8, 10))}
                  </button>

                  {/*
                    狭い画面: 帯と点は数px しかなく指では押せないため、表示専用にする。
                    タップ対象はセル全体とし、その日の詳細へ移動する。
                  */}
                  <button
                    type="button"
                    onClick={() => onSelectDay(dateKey)}
                    aria-label={`${Number(dateKey.slice(8, 10))}日 予定${dayEvents.length}件 タスク${dayTasks.length}件`}
                    className="flex min-w-0 flex-1 flex-col items-stretch gap-[3px] sm:hidden"
                  >
                    {dayEvents.slice(0, MOBILE_MAX_BARS).map((event) => (
                      <span
                        key={event.id}
                        aria-hidden
                        className="h-1 w-full rounded-xs border"
                        style={{
                          backgroundColor: eventColors(event.color).background,
                          borderColor: eventColors(event.color).border,
                        }}
                      />
                    ))}

                    {dayTasks.length > 0 && (
                      <span aria-hidden className="flex flex-wrap items-center gap-[3px] pt-px">
                        {dayTasks.slice(0, MOBILE_MAX_DOTS).map((task) => (
                          <span
                            key={task.id}
                            className={cn(
                              "size-1.5 rounded-full",
                              task.done ? "bg-on-surface-variant/50" : "bg-primary",
                            )}
                          />
                        ))}
                      </span>
                    )}

                    {mobileHiddenCount(dayEvents.length, dayTasks.length) > 0 && (
                      <span aria-hidden className="type-label-small text-left text-on-surface-variant">
                        +{mobileHiddenCount(dayEvents.length, dayTasks.length)}
                      </span>
                    )}
                  </button>

                  {/* 広い画面: 時刻とタイトルまで読める。 */}
                  <div className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                    {visible.map((item) =>
                      item.kind === "event" ? (
                        <EventChip
                          key={item.id}
                          event={item}
                          utils={utils}
                          onOpen={() => onOpenEvent(item)}
                        />
                      ) : (
                        <TaskChip
                          key={item.id}
                          task={item}
                          utils={utils}
                          onOpen={() => onOpenTask(item)}
                        />
                      ),
                    )}
                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        onClick={() => onSelectDay(dateKey)}
                        className="truncate px-1 text-left text-[10px] whitespace-nowrap text-on-surface-variant hover:text-foreground"
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
}: {
  event: CalendarEventItem;
  utils: CalendarDateUtils;
  onOpen: () => void;
}) {
  const colors = eventColors(event.color);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="type-label-small flex w-full min-w-0 items-center gap-1 overflow-hidden rounded-xs border px-1 py-px text-left"
      style={{
        backgroundColor: colors.background,
        color: colors.foreground,
        borderColor: colors.border,
      }}
      title={event.title}
    >
      {!event.allDay && <span className="shrink-0 opacity-75">{utils.formatTime(event.start)}</span>}
      <span className="truncate">{event.title}</span>
    </button>
  );
}

/** タスクは期限という「点」。塗らず、先頭に目盛りを立てて予定と描き分ける（docs/spec.md §5）。 */
function TaskChip({
  task,
  utils,
  onOpen,
}: {
  task: TaskItem;
  utils: CalendarDateUtils;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex h-1.5 w-full min-w-0 items-center gap-1 overflow-hidden rounded-full border border-primary/60 bg-surface-container-lowest text-left text-[11px] leading-4 font-medium sm:h-auto sm:rounded-sm sm:border-outline sm:px-1",
        task.done && "border-outline-variant text-on-surface-variant line-through",
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
        <span className="shrink-0 opacity-70">{utils.formatTime(task.due)}</span>
      )}
      <span className="truncate">{task.title}</span>
    </button>
  );
}
