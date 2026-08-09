"use client";

import { cn } from "@/lib/utils";
import type { CalendarEventItem, TaskItem } from "@/types/calendar";

import {
  GRID_HEIGHT,
  HOUR_HEIGHT,
  MINUTES_PER_DAY,
  type CalendarDateUtils,
} from "./item-layout";
import { useGridDrag, type DragCommit, type DragPreview, type DragTarget } from "./use-grid-drag";

export function TimeGridView({
  days,
  events,
  tasks,
  utils,
  onOpenEvent,
  onOpenTask,
  onSelectSlot,
  onDragCommit,
}: {
  days: string[];
  events: CalendarEventItem[];
  tasks: TaskItem[];
  utils: CalendarDateUtils;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  /** 空き時間の選択。minutes は 0:00 からの分数（30分単位に丸める）。 */
  onSelectSlot: (dateKey: string, minutes: number) => void;
  onDragCommit: (commit: DragCommit) => void;
}) {
  const todayKey = utils.todayKey();
  const {
    gridRef,
    preview,
    startDrag,
    handlePointerMove,
    handlePointerUp,
    consumeDragClick,
  } = useGridDrag({ days, onCommit: onDragCommit });

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

      <AllDayArea
        days={days}
        events={events}
        tasks={tasks}
        utils={utils}
        onOpenEvent={onOpenEvent}
        onOpenTask={onOpenTask}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          ref={gridRef}
          data-gutter-width="48"
          className="flex"
          style={{ height: HOUR_HEIGHT * 24 }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
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

          {days.map((dateKey, dayIndex) => (
            <DayColumn
              key={dateKey}
              dateKey={dateKey}
              dayIndex={dayIndex}
              preview={preview}
              onStartDrag={startDrag}
              onConsumeDragClick={consumeDragClick}
              utils={utils}
              onOpenEvent={onOpenEvent}
              onOpenTask={onOpenTask}
              onSelectSlot={onSelectSlot}
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
  dayIndex,
  events,
  tasks,
  utils,
  preview,
  onStartDrag,
  onConsumeDragClick,
  onOpenEvent,
  onOpenTask,
  onSelectSlot,
}: {
  dateKey: string;
  dayIndex: number;
  events: CalendarEventItem[];
  tasks: TaskItem[];
  utils: CalendarDateUtils;
  preview: DragPreview | null;
  onStartDrag: (
    event: React.PointerEvent,
    target: DragTarget,
    geometry: { dayIndex: number; startMinutes: number; endMinutes: number },
  ) => void;
  onConsumeDragClick: () => boolean;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onSelectSlot: (dateKey: string, minutes: number) => void;
}) {
  const positioned = utils.layoutOverlaps(events, dateKey);

  /** ドラッグ中の項目は、この列に移動してきた場合だけこの列で描く。 */
  const previewFor = (id: string): DragPreview | null => {
    if (!preview || preview.id !== id) return null;
    return preview.dayIndex === dayIndex ? preview : null;
  };

  const isDraggedAway = (id: string) => preview?.id === id && preview.dayIndex !== dayIndex;

  const handleBackgroundClick = (clientY: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
    // 30分単位に丸める。1分刻みで開くと、その後の時刻調整がかえって手間になるため。
    const minutes = Math.floor((ratio * MINUTES_PER_DAY) / 30) * 30;
    onSelectSlot(dateKey, Math.min(minutes, MINUTES_PER_DAY - 30));
  };

  return (
    <div className="relative flex-1 border-l">
      {/* 空き時間の選択。予定・タスクはこの上に重ねて描画するので、
          クリックが背面へ抜けることはない（docs/spec.md §15）。 */}
      <button
        type="button"
        aria-label={`${dateKey} の空き時間に追加`}
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={(e) => handleBackgroundClick(e.clientY, e.currentTarget)}
      />

      {Array.from({ length: 24 }, (_, hour) => (
        <div
          key={hour}
          className="pointer-events-none absolute inset-x-0 border-t border-border/60"
          style={{ top: hour * HOUR_HEIGHT }}
        />
      ))}

      {positioned.map(({ event, column, columns }) => {
        if (isDraggedAway(event.id)) return null;

        const base = utils.eventGeometry(event, dateKey);
        const eventPreview = previewFor(event.id);
        const top = eventPreview
          ? (eventPreview.startMinutes / MINUTES_PER_DAY) * GRID_HEIGHT
          : base.top;
        const height = eventPreview
          ? Math.max(
              ((eventPreview.endMinutes - eventPreview.startMinutes) / MINUTES_PER_DAY) *
                GRID_HEIGHT,
              16,
            )
          : base.height;

        // 日をまたぐ予定は、どの日を動かしているのかが決まらないためドラッグの対象外にする。
        const draggable =
          utils.itemDateKey(event.start) === utils.itemDateKey(event.end) ||
          utils.itemDateKey(event.start) === dateKey;

        const geometry = {
          dayIndex,
          startMinutes: utils.minutesFromMidnight(event.start),
          endMinutes: Math.max(
            utils.minutesFromMidnight(event.end),
            utils.minutesFromMidnight(event.start) + 15,
          ),
        };

        return (
          <div
            key={event.id}
            className="absolute"
            style={{
              top,
              height,
              left: `${(column / columns) * 100}%`,
              width: `${(1 / columns) * 100}%`,
            }}
          >
            <button
              type="button"
              onPointerDown={(e) => {
                if (!draggable) return;
                onStartDrag(e, { kind: "event", item: event, mode: "move" }, geometry);
              }}
              onClick={() => {
                if (onConsumeDragClick()) return;
                onOpenEvent(event);
              }}
              className={cn(
                "size-full overflow-hidden rounded px-1 text-left text-[10px] leading-4 text-white",
                eventPreview && "opacity-80 ring-2 ring-foreground/40",
              )}
              style={{ backgroundColor: event.color ?? "#5484ed" }}
              title={`${utils.formatTime(event.start)}–${utils.formatTime(event.end)} ${event.title}`}
            >
              <div className="truncate font-medium">{event.title}</div>
              <div className="truncate opacity-80">
                {eventPreview
                  ? formatMinutes(eventPreview.startMinutes)
                  : utils.formatTime(event.start)}
              </div>
            </button>

            {draggable && (
              <>
                <ResizeHandle
                  position="top"
                  onPointerDown={(e) =>
                    onStartDrag(e, { kind: "event", item: event, mode: "resize-start" }, geometry)
                  }
                />
                <ResizeHandle
                  position="bottom"
                  onPointerDown={(e) =>
                    onStartDrag(e, { kind: "event", item: event, mode: "resize-end" }, geometry)
                  }
                />
              </>
            )}
          </div>
        );
      })}

      {/* 期限タスクは予定のような時間幅を持たせず、期限時刻の位置に置く（docs/spec.md §6）。 */}
      {tasks.map((task) => isDraggedAway(task.id) ? null : (
        <button
          key={task.id}
          type="button"
          onPointerDown={(e) =>
            onStartDrag(
              e,
              { kind: "task", item: task },
              {
                dayIndex,
                startMinutes: utils.minutesFromMidnight(task.due!),
                endMinutes: utils.minutesFromMidnight(task.due!),
              },
            )
          }
          onClick={() => {
            if (onConsumeDragClick()) return;
            onOpenTask(task);
          }}
          className="absolute inset-x-0 flex items-center gap-1 px-1"
          style={{
            top:
              ((previewFor(task.id)?.startMinutes ?? utils.minutesFromMidnight(task.due!)) /
                MINUTES_PER_DAY) *
              GRID_HEIGHT,
          }}
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
        </button>
      ))}
    </div>
  );
}

function AllDayArea({
  days,
  events,
  tasks,
  utils,
  onOpenEvent,
  onOpenTask,
}: {
  days: string[];
  events: CalendarEventItem[];
  tasks: TaskItem[];
  utils: CalendarDateUtils;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
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
              <button
                key={event.id}
                type="button"
                onClick={() => onOpenEvent(event)}
                className="truncate rounded px-1 text-left text-[10px] leading-4 text-white"
                style={{ backgroundColor: event.color ?? "#5484ed" }}
                title={event.title}
              >
                {event.title}
              </button>
            ))}
            {dayTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => onOpenTask(task)}
                className={cn(
                  "truncate rounded border border-dashed px-1 text-left text-[10px] leading-4",
                  task.done && "text-muted-foreground line-through",
                )}
                title={task.title}
              >
                <span aria-hidden className="mr-1">
                  {task.done ? "☑" : "☐"}
                </span>
                {task.title}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** 予定ブロックの上端・下端。ここを掴むと開始または終了だけが動く。 */
function ResizeHandle({
  position,
  onPointerDown,
}: {
  position: "top" | "bottom";
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={position === "top" ? "開始時刻を変更" : "終了時刻を変更"}
      onPointerDown={onPointerDown}
      className={cn(
        "absolute inset-x-0 h-2 cursor-ns-resize",
        position === "top" ? "top-0" : "bottom-0",
      )}
    />
  );
}

function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function weekdayLabel(dateKey: string): string {
  const labels = ["日", "月", "火", "水", "木", "金", "土"];
  return labels[new Date(`${dateKey}T12:00:00Z`).getUTCDay()];
}
