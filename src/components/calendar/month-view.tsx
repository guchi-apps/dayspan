"use client";

import { cn } from "@/lib/utils";
import type { CalendarEventItem, TaskItem } from "@/types/calendar";
import type { CalendarEventItem as EventItem, TaskItem as Task } from "@/types/calendar";

import { eventColors } from "./calendar-color";
import type { CalendarDateUtils } from "./item-layout";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// 1日のマスに詰め込みすぎると月全体が読めなくなるため、上限を超えた分は件数で畳む。
// 行の高さは画面の高さを6分割した値で決まるため、狭い画面では1件少なくする。
const MAX_ITEMS_PER_DAY = 4;
const MOBILE_MAX_ITEMS = 3;

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
              const mobileHidden = dayItems.length - MOBILE_MAX_ITEMS;
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
        "flex h-4 w-full min-w-0 items-center gap-1 overflow-hidden rounded-xs border px-0.5 text-left text-[10px] leading-4 font-medium sm:type-label-small sm:h-auto sm:px-1 sm:py-px",
        desktopOnly && "hidden sm:flex",
      )}
      style={{
        backgroundColor: colors.background,
        color: colors.foreground,
        borderColor: colors.border,
      }}
      title={event.title}
    >
      {/* 狭い列では時刻が本文の幅を奪う。時刻は日表示で確認できるので、ここでは題名を優先する。 */}
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
        "flex h-4 w-full min-w-0 items-center gap-1 overflow-hidden rounded-xs border border-outline bg-surface-container-lowest px-0.5 text-left text-[10px] leading-4 font-medium sm:type-label-small sm:h-auto sm:px-1 sm:py-px",
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
