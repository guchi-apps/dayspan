"use client";

import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
import { eventColors } from "./calendar-color";
import type { CalendarEventItem, TaskItem } from "@/types/calendar";

import {
  GRID_HEIGHT,
  HOUR_HEIGHT,
  MINUTES_PER_DAY,
  type CalendarDateUtils,
} from "./item-layout";
import {
  useAllDayDrag,
  useGridDrag,
  type AllDayDragCommit,
  type AllDayDragPreview,
  type AllDayDragTarget,
  type DragCommit,
  type DragPreview,
  type DragTarget,
} from "./use-grid-drag";

export function TimeGridView({
  days,
  events,
  tasks,
  utils,
  onOpenEvent,
  onOpenTask,
  onSelectSlot,
  onDragCommit,
  onAllDayDragCommit,
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
  onAllDayDragCommit: (commit: AllDayDragCommit) => void;
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

  const {
    rowRef: allDayRowRef,
    preview: allDayPreview,
    startDrag: startAllDayDrag,
    handlePointerMove: handleAllDayPointerMove,
    handlePointerUp: handleAllDayPointerUp,
    consumeDragClick: consumeAllDayDragClick,
  } = useAllDayDrag({ days, onCommit: onAllDayDragCommit });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex border-b border-outline-variant">
        <div className="w-14 shrink-0" />
        {days.map((dateKey) => (
          <div key={dateKey} className="flex-1 py-1.5 text-center">
            <div
              className={cn(
                "text-[10px] tracking-widest",
                weekdayTone(dateKey) ?? "text-muted-foreground",
              )}
            >
              {weekdayLabel(dateKey)}
            </div>
            <div
              className={cn(
                "mx-auto mt-0.5 grid size-7 place-items-center rounded-full text-sm",
                dateKey === todayKey
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "font-medium",
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
        rowRef={allDayRowRef}
        preview={allDayPreview}
        onStartDrag={startAllDayDrag}
        onConsumeDragClick={consumeAllDayDragClick}
        onPointerMove={handleAllDayPointerMove}
        onPointerUp={handleAllDayPointerUp}
        onOpenEvent={onOpenEvent}
        onOpenTask={onOpenTask}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          ref={gridRef}
          data-gutter-width="56"
          className="relative flex"
          style={{ height: HOUR_HEIGHT * 24 }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className="relative w-14 shrink-0">
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                className={cn(
                  "absolute right-2 -translate-y-1/2 text-[10px]",
                  // 6時間ごと（0/6/12/18時）を強めて、一日の四分割が目で追えるようにする。
                  hour % 6 === 0 ? "font-medium text-foreground" : "text-muted-foreground",
                )}
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {hour > 0 && `${String(hour).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          <NowLine days={days} utils={utils} />

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
    <div className="relative flex-1 border-l border-outline-variant">
      {/* 空き時間の選択。予定・タスクはこの上に重ねて描画するので、
          クリックが背面へ抜けることはない（docs/spec.md §15）。 */}
      <button
        type="button"
        aria-label={`${dateKey} の空き時間に追加`}
        className="absolute inset-0 h-full w-full cursor-default"
        onClick={(e) => handleBackgroundClick(e.clientY, e.currentTarget)}
      />

      {Array.from({ length: 48 }, (_, index) => {
        const isHour = index % 2 === 0;
        const isMajor = index % 12 === 0;

        return (
          <div
            key={index}
            className={cn(
              "pointer-events-none absolute inset-x-0 border-t",
              isMajor
                ? "border-outline/50"
                : isHour
                  ? "border-outline-variant"
                  : "border-outline-variant/45",
            )}
            style={{ top: (index * HOUR_HEIGHT) / 2 }}
          />
        );
      })}

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

        const colors = eventColors(event.color);

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
                "size-full overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight",
                eventPreview && "ring-2 ring-foreground/50",
              )}
              style={{
                backgroundColor: colors.background,
                color: colors.foreground,
                borderColor: colors.border,
              }}
              title={`${utils.formatTime(event.start)}–${utils.formatTime(event.end)} ${event.title}`}
            >
              <div className="truncate font-semibold">{event.title}</div>
              {/* 短い予定で時刻まで出すと文字が潰れるため、高さに余裕があるときだけ添える。 */}
              {height >= 40 && (
                <div className="truncate opacity-75">
                  {eventPreview
                    ? formatMinutes(eventPreview.startMinutes)
                    : utils.formatTime(event.start)}
                </div>
              )}
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
          className="absolute inset-x-0 flex -translate-y-1/2 items-center gap-1 pr-1"
          style={{
            top:
              ((previewFor(task.id)?.startMinutes ?? utils.minutesFromMidnight(task.due!)) /
                MINUTES_PER_DAY) *
              GRID_HEIGHT,
          }}
          title={`${utils.formatTime(task.due!)} ${task.title}`}
        >
          {/* 予定が「幅」なのに対し、タスクは期限という「点」。目盛り線として描き分ける。 */}
          <span
            aria-hidden
            className={cn(
              "h-2.5 w-0.5 shrink-0",
              task.done ? "bg-on-surface-variant/60" : "bg-primary",
            )}
          />
          <span
            className={cn(
              "h-px flex-1",
              task.done ? "bg-on-surface-variant/30" : "bg-primary/45",
            )}
          />
          <span
            className={cn(
              "type-label-small max-w-[78%] truncate rounded-xs border border-outline bg-surface-container-lowest px-1",
              task.done && "text-muted-foreground line-through",
            )}
          >
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
  rowRef,
  preview,
  onStartDrag,
  onConsumeDragClick,
  onPointerMove,
  onPointerUp,
  onOpenEvent,
  onOpenTask,
}: {
  days: string[];
  events: CalendarEventItem[];
  tasks: TaskItem[];
  utils: CalendarDateUtils;
  rowRef: React.Ref<HTMLDivElement>;
  preview: AllDayDragPreview | null;
  onStartDrag: (
    event: React.PointerEvent,
    target: AllDayDragTarget,
    dayIndex: number,
  ) => void;
  onConsumeDragClick: () => boolean;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
}) {
  // ドラッグ中の項目は、動かした日数分ずらした状態で判定・描画する。
  const shiftedEvent = (event: CalendarEventItem): CalendarEventItem =>
    preview?.id === event.id
      ? {
          ...event,
          start: shiftDateKey(event.start, preview.deltaDays),
          end: shiftDateKey(event.end, preview.deltaDays),
        }
      : event;

  const shiftedTaskDue = (task: TaskItem): string | null =>
    preview?.id === task.id && task.due
      ? shiftDateKey(task.due, preview.deltaDays)
      : task.due;

  return (
    <div
      ref={rowRef}
      data-gutter-width="56"
      className="flex border-b border-outline-variant bg-surface-container-low"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="w-14 shrink-0 py-1.5 pr-2 text-right text-[10px] tracking-wide text-muted-foreground">
        終日
      </div>
      {days.map((dateKey, dayIndex) => {
        const dayEvents = events.filter(
          (event) => event.allDay && utils.eventCoversDay(shiftedEvent(event), dateKey),
        );
        const dayTasks = tasks.filter(
          (task) => !task.hasTime && shiftedTaskDue(task) === dateKey,
        );

        return (
          <div
            key={dateKey}
            className="flex min-h-9 flex-1 flex-col gap-0.5 border-l border-outline-variant p-1"
          >
            {dayEvents.map((event) => (
              <button
                key={event.id}
                type="button"
                onPointerDown={(e) => onStartDrag(e, { kind: "event", item: event }, dayIndex)}
                onClick={() => {
                  if (onConsumeDragClick()) return;
                  onOpenEvent(event);
                }}
                className={cn(
                  "truncate rounded-sm border px-1.5 text-left text-[11px] leading-5 font-medium",
                  preview?.id === event.id && "ring-2 ring-foreground/50",
                )}
                style={{
                  backgroundColor: eventColors(event.color).background,
                  color: eventColors(event.color).foreground,
                  borderColor: eventColors(event.color).border,
                }}
                title={event.title}
              >
                {event.title}
              </button>
            ))}
            {dayTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onPointerDown={(e) => onStartDrag(e, { kind: "task", item: task }, dayIndex)}
                onClick={() => {
                  if (onConsumeDragClick()) return;
                  onOpenTask(task);
                }}
                className={cn(
                  "type-label-small flex items-center gap-1 truncate rounded-xs border border-outline bg-surface-container-lowest px-1.5 py-0.5 text-left",
                  task.done && "text-muted-foreground line-through",
                  preview?.id === task.id && "ring-2 ring-foreground/50",
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
                <span className="truncate">{task.title}</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** YYYY-MM-DD を日数分ずらす。UTC正午で扱い、タイムゾーンによる日付ずれを避ける。 */
function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

/**
 * 分単位の現在時刻。時計はReactの外にある変化する値なので、状態として持たず購読する。
 * サーバー側では値を返さないため、ハイドレーションのずれも起きない。
 */
function useMinuteBucket(): number | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      const timer = setInterval(onStoreChange, 30_000);
      return () => clearInterval(timer);
    },
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );
}

/**
 * 現在時刻の線。画面上で唯一の純黒の水平線にして、いま何時かを一目で掴めるようにする。
 * 予定の色は元カレンダー由来で多彩なため、時刻の指標に色を使わず明度で際立たせる。
 */
function NowLine({ days, utils }: { days: string[]; utils: CalendarDateUtils }) {
  const minuteBucket = useMinuteBucket();

  // サーバー描画時は現在時刻を持たない（時計はクライアント側の外部状態として購読する）。
  if (minuteBucket === null) return null;

  const iso = new Date(minuteBucket * 60_000).toISOString();
  const todayKey = utils.todayKey();
  const todayIndex = days.indexOf(todayKey);

  // 表示中の期間に今日が含まれないときは、線を引く意味がない。
  if (todayIndex < 0) return null;

  const minutes = utils.minutesFromMidnight(iso);
  const top = (minutes / MINUTES_PER_DAY) * GRID_HEIGHT;

  return (
    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ top }}>
      <span className="type-label-small absolute left-0 w-14 -translate-y-1/2 pr-2 text-right text-primary">
        {utils.formatTime(iso)}
      </span>

      <span className="absolute right-0 left-14 block h-px bg-primary" />

      <span
        className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
        style={{ left: `calc(3.5rem + (100% - 3.5rem) * ${(todayIndex + 0.5) / days.length})` }}
      />
    </div>
  );
}

/** 土日は日本のカレンダーの慣習に合わせて色を変える。彩度は落とし、予定の色より前に出さない。 */
function weekdayTone(dateKey: string): string | null {
  const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  if (day === 0) return "text-rose-700/80 dark:text-rose-300/80";
  if (day === 6) return "text-sky-700/80 dark:text-sky-300/80";
  return null;
}

function weekdayLabel(dateKey: string): string {
  const labels = ["日", "月", "火", "水", "木", "金", "土"];
  return labels[new Date(`${dateKey}T12:00:00Z`).getUTCDay()];
}
