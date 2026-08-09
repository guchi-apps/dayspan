"use client";

import { cn } from "@/lib/utils";
import type { CalendarEventItem, TaskItem } from "@/types/calendar";
import type { CalendarEventItem as EventItem, TaskItem as Task } from "@/types/calendar";

import { eventColors } from "./calendar-color";
import type { CalendarDateUtils } from "./item-layout";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// 1日のマスに詰め込みすぎると月全体が読めなくなるため、上限を超えた分は件数で畳む。
const MAX_ITEMS_PER_DAY = 3;

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
      <div className="grid grid-cols-7 border-b border-rule">
        {Array.from({ length: 7 }, (_, index) => {
          const weekday = (weekStartsOn + index) % 7;

          return (
            <div
              key={weekday}
              className={cn(
                "py-1.5 text-center text-[10px] tracking-widest",
                weekday === 0
                  ? "text-rose-700/80 dark:text-rose-300/80"
                  : weekday === 6
                    ? "text-sky-700/80 dark:text-sky-300/80"
                    : "text-muted-foreground",
              )}
            >
              {WEEKDAY_LABELS[weekday]}
            </div>
          );
        })}
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-6">
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7 border-b border-rule last:border-b-0">
            {week.map((dateKey) => {
              const dayItems = [
                ...events.filter((event) => utils.eventCoversDay(event, dateKey)),
                ...tasks.filter((task) => utils.taskCoversDay(task, dateKey)),
              ].sort(utils.compareItems);

              const visible = dayItems.slice(0, MAX_ITEMS_PER_DAY);
              const hiddenCount = dayItems.length - visible.length;
              const inMonth = dateKey.slice(0, 7) === anchorMonth;
              const isToday = dateKey === todayKey;

              return (
                <div
                  key={dateKey}
                  className={cn(
                    "flex min-w-0 flex-col gap-1 border-r border-rule p-1 last:border-r-0",
                    !inMonth && "bg-muted/25",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectDay(dateKey)}
                    className={cn(
                      "grid size-6 shrink-0 place-items-center self-start rounded-full text-xs",
                      isToday
                        ? "bg-foreground font-semibold text-background"
                        : inMonth
                          ? "font-medium hover:bg-muted"
                          : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {Number(dateKey.slice(8, 10))}
                  </button>

                  <div className="flex min-w-0 flex-col gap-0.5">
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
                        className="px-1 text-left text-[10px] text-muted-foreground hover:text-foreground"
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
      className="flex items-center gap-1 truncate rounded-sm border px-1 text-left text-[11px] leading-4 font-medium"
      style={{
        backgroundColor: colors.background,
        color: colors.foreground,
        borderColor: colors.border,
      }}
      title={event.title}
    >
      {!event.allDay && (
        <span className="shrink-0 opacity-75">{utils.formatTime(event.start)}</span>
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
        "flex items-center gap-1 truncate rounded-sm border border-rule-strong bg-background px-1 text-left text-[11px] leading-4 font-medium",
        task.done && "text-muted-foreground line-through",
      )}
      title={task.title}
    >
      <span
        aria-hidden
        className={cn("h-2.5 w-0.5 shrink-0", task.done ? "bg-muted-foreground" : "bg-foreground")}
      />
      {task.hasTime && task.due && (
        <span className="shrink-0 opacity-70">{utils.formatTime(task.due)}</span>
      )}
      <span className="truncate">{task.title}</span>
    </button>
  );
}
