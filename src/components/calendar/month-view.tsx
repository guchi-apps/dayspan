"use client";

import { cn } from "@/lib/utils";
import type { CalendarEventItem, TaskItem } from "@/types/calendar";

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
  weekStartsOn,
  utils,
}: {
  weeks: string[][];
  anchorMonth: string;
  events: CalendarEventItem[];
  tasks: TaskItem[];
  onSelectDay: (dateKey: string) => void;
  weekStartsOn: number;
  utils: CalendarDateUtils;
}) {
  const todayKey = utils.todayKey();

  const weekdayLabels = Array.from(
    { length: 7 },
    (_, i) => WEEKDAY_LABELS[(weekStartsOn + i) % 7],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b">
        {weekdayLabels.map((label, index) => (
          <div
            key={label}
            className={cn(
              "py-1 text-center text-xs font-medium text-muted-foreground",
              (weekStartsOn + index) % 7 === 0 && "text-red-600 dark:text-red-400",
              (weekStartsOn + index) % 7 === 6 && "text-blue-600 dark:text-blue-400",
            )}
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-6">
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7 border-b last:border-b-0">
            {week.map((dateKey) => {
              const dayItems = [
                ...events.filter((event) => utils.eventCoversDay(event, dateKey)),
                ...tasks.filter((task) => utils.taskCoversDay(task, dateKey)),
              ].sort(utils.compareItems);

              const visible = dayItems.slice(0, MAX_ITEMS_PER_DAY);
              const hiddenCount = dayItems.length - visible.length;
              const inMonth = dateKey.slice(0, 7) === anchorMonth;

              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => onSelectDay(dateKey)}
                  className={cn(
                    "flex min-w-0 flex-col gap-0.5 border-r p-1 text-left last:border-r-0 hover:bg-muted/50",
                    !inMonth && "bg-muted/20",
                  )}
                >
                  <span
                    className={cn(
                      "self-start rounded-full px-1 text-xs",
                      !inMonth && "text-muted-foreground",
                      dateKey === todayKey && "bg-primary text-primary-foreground",
                    )}
                  >
                    {Number(dateKey.slice(8, 10))}
                  </span>

                  <div className="flex min-w-0 flex-col gap-0.5">
                    {visible.map((item) =>
                      item.kind === "event" ? (
                        <EventChip key={item.id} event={item} utils={utils} />
                      ) : (
                        <TaskChip key={item.id} task={item} utils={utils} />
                      ),
                    )}
                    {hiddenCount > 0 && (
                      <span className="px-0.5 text-[10px] text-muted-foreground">
                        +{hiddenCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function EventChip({ event, utils }: { event: CalendarEventItem; utils: CalendarDateUtils }) {
  return (
    <span
      className="truncate rounded px-1 text-[10px] leading-4 text-white"
      style={{ backgroundColor: event.color ?? "#5484ed" }}
      title={event.title}
    >
      {!event.allDay && <span className="mr-1 opacity-80">{utils.formatTime(event.start)}</span>}
      {event.title}
    </span>
  );
}

// タスクは予定と判別できる必要がある（docs/spec.md §5）。塗りつぶしの予定に対して、
// 枠線＋チェック記号の抜き表現で区別する。
function TaskChip({ task, utils }: { task: TaskItem; utils: CalendarDateUtils }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1 truncate rounded border border-dashed px-1 text-[10px] leading-4",
        task.done ? "text-muted-foreground line-through" : "text-foreground",
      )}
      title={task.title}
    >
      <span aria-hidden>{task.done ? "☑" : "☐"}</span>
      {task.hasTime && task.due && (
        <span className="opacity-70">{utils.formatTime(task.due)}</span>
      )}
      <span className="truncate">{task.title}</span>
    </span>
  );
}
