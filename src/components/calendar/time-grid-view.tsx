"use client";

import { cn } from "@/lib/utils";
import type { CalendarEventItem, TaskItem } from "@/types/calendar";

import {
  GRID_HEIGHT,
  HOUR_HEIGHT,
  MINUTES_PER_DAY,
  type CalendarDateUtils,
} from "./item-layout";

export function TimeGridView({
  days,
  events,
  tasks,
  utils,
}: {
  days: string[];
  events: CalendarEventItem[];
  tasks: TaskItem[];
  utils: CalendarDateUtils;
}) {
  const todayKey = utils.todayKey();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex border-b">
        <div className="w-12 shrink-0" />
        {days.map((dateKey) => (
          <div key={dateKey} className="flex-1 py-1 text-center">
            <div className="text-xs text-muted-foreground">{weekdayLabel(dateKey)}</div>
            <div
              className={cn(
                "mx-auto w-7 rounded-full text-sm",
                dateKey === todayKey && "bg-primary text-primary-foreground",
              )}
            >
              {Number(dateKey.slice(8, 10))}
            </div>
          </div>
        ))}
      </div>

      <AllDayArea days={days} events={events} tasks={tasks} utils={utils} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ height: HOUR_HEIGHT * 24 }}>
          <div className="relative w-12 shrink-0">
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {hour > 0 && `${String(hour).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          {days.map((dateKey) => (
            <DayColumn
              key={dateKey}
              dateKey={dateKey}
              utils={utils}
              events={events.filter(
                (event) => !event.allDay && utils.eventCoversDay(event, dateKey),
              )}
              tasks={tasks.filter((task) => task.hasTime && utils.taskCoversDay(task, dateKey))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  dateKey,
  events,
  tasks,
  utils,
}: {
  dateKey: string;
  events: CalendarEventItem[];
  tasks: TaskItem[];
  utils: CalendarDateUtils;
}) {
  const positioned = utils.layoutOverlaps(events, dateKey);

  return (
    <div className="relative flex-1 border-l">
      {Array.from({ length: 24 }, (_, hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 border-t border-border/60"
          style={{ top: hour * HOUR_HEIGHT }}
        />
      ))}

      {positioned.map(({ event, column, columns }) => {
        const { top, height } = utils.eventGeometry(event, dateKey);
        return (
          <div
            key={event.id}
            className="absolute overflow-hidden rounded px-1 text-[10px] leading-4 text-white"
            style={{
              top,
              height,
              left: `${(column / columns) * 100}%`,
              width: `${(1 / columns) * 100}%`,
              backgroundColor: event.color ?? "#5484ed",
            }}
            title={`${utils.formatTime(event.start)}–${utils.formatTime(event.end)} ${event.title}`}
          >
            <div className="truncate font-medium">{event.title}</div>
            <div className="truncate opacity-80">{utils.formatTime(event.start)}</div>
          </div>
        );
      })}

      {/* 期限タスクは予定のような時間幅を持たせず、期限時刻の位置に置く（docs/spec.md §6）。 */}
      {tasks.map((task) => (
        <div
          key={task.id}
          className="absolute inset-x-0 flex items-center gap-1 px-1"
          style={{ top: (utils.minutesFromMidnight(task.due!) / MINUTES_PER_DAY) * GRID_HEIGHT }}
          title={`${utils.formatTime(task.due!)} ${task.title}`}
        >
          <span className="h-0 flex-1 border-t-2 border-dashed border-foreground/40" />
          <span
            className={cn(
              "max-w-[80%] truncate rounded border border-dashed bg-background px-1 text-[10px]",
              task.done && "text-muted-foreground line-through",
            )}
          >
            <span aria-hidden className="mr-1">
              {task.done ? "☑" : "☐"}
            </span>
            {task.title}
          </span>
        </div>
      ))}
    </div>
  );
}

function AllDayArea({
  days,
  events,
  tasks,
  utils,
}: {
  days: string[];
  events: CalendarEventItem[];
  tasks: TaskItem[];
  utils: CalendarDateUtils;
}) {
  return (
    <div className="flex border-b bg-muted/20">
      <div className="w-12 shrink-0 py-1 pr-1 text-right text-[10px] text-muted-foreground">
        終日
      </div>
      {days.map((dateKey) => {
        const dayEvents = events.filter(
          (event) => event.allDay && utils.eventCoversDay(event, dateKey),
        );
        const dayTasks = tasks.filter(
          (task) => !task.hasTime && utils.taskCoversDay(task, dateKey),
        );

        return (
          <div key={dateKey} className="flex min-h-8 flex-1 flex-col gap-0.5 border-l p-0.5">
            {dayEvents.map((event) => (
              <span
                key={event.id}
                className="truncate rounded px-1 text-[10px] leading-4 text-white"
                style={{ backgroundColor: event.color ?? "#5484ed" }}
                title={event.title}
              >
                {event.title}
              </span>
            ))}
            {dayTasks.map((task) => (
              <span
                key={task.id}
                className={cn(
                  "truncate rounded border border-dashed px-1 text-[10px] leading-4",
                  task.done && "text-muted-foreground line-through",
                )}
                title={task.title}
              >
                <span aria-hidden className="mr-1">
                  {task.done ? "☑" : "☐"}
                </span>
                {task.title}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function weekdayLabel(dateKey: string): string {
  const labels = ["日", "月", "火", "水", "木", "金", "土"];
  return labels[new Date(`${dateKey}T12:00:00Z`).getUTCDay()];
}
