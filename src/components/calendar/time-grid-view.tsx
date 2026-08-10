"use client";

import { memo, useMemo, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
import { eventColors } from "./calendar-color";
import type { CalendarEventItem, ReminderItem, TaskItem } from "@/types/calendar";

import {
  GRID_HEIGHT,
  HOUR_HEIGHT,
  MINUTES_PER_DAY,
  type CalendarDateUtils,
} from "./item-layout";
import { SWIPE_SNAP_EASING, SWIPE_SNAP_MS, useDaySwipe } from "./use-day-swipe";
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

/** 左から順に、前の期間・表示中の期間・次の期間。 */
type PaneDays = [string[], string[], string[]];

// 閲覧のみのときに渡す。日ごとの列は memo で包んであるため、
// ここで作り直すと readOnly の間だけ毎回描き直しになる。
const NOOP = () => {};

export function TimeGridView({
  days,
  events,
  tasks,
  reminders,
  utils,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
  onSelectSlot,
  onDragCommit,
  onAllDayDragCommit,
  onSwipe,
  readOnly = false,
}: {
  days: string[];
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  utils: CalendarDateUtils;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onOpenReminder: (reminder: ReminderItem) => void;
  /** 空き時間の選択。minutes は 0:00 からの分数（30分単位に丸める）。 */
  onSelectSlot: (dateKey: string, minutes: number) => void;
  onDragCommit: (commit: DragCommit) => void;
  onAllDayDragCommit: (commit: AllDayDragCommit) => void;
  /** 左右スワイプで日付を送る。正で先の日付へ。 */
  onSwipe: (deltaDays: number) => void;
  /**
   * 閲覧のみにする。オフライン中に使う（docs/spec.md §21）。
   * 掴んだあとで断るのではなく、掴めない・空き時間を選べない状態にする。
   * 動かせたのに戻る、という見え方をさせないため。
   */
  readOnly?: boolean;
}) {
  const todayKey = utils.todayKey();
  const {
    gridRef,
    preview,
    dragging,
    startDrag: startDragWhenEditable,
    handlePointerMove,
    handlePointerUp,
    consumeDragClick,
  } = useGridDrag({ days, onCommit: onDragCommit });

  const {
    rowRef: allDayRowRef,
    preview: allDayPreview,
    dragging: allDayDragging,
    startDrag: startAllDayDragWhenEditable,
    handlePointerMove: handleAllDayPointerMove,
    handlePointerUp: handleAllDayPointerUp,
    consumeDragClick: consumeAllDayDragClick,
  } = useAllDayDrag({ days, onCommit: onAllDayDragCommit });

  // 閲覧のみのときは、掴む・空き時間を選ぶという書き込みの入口をふさぐ。
  // タップして内容を見ることと、左右スワイプでの移動はそのまま使える。
  const startDrag = readOnly ? NOOP : startDragWhenEditable;
  const startAllDayDrag = readOnly ? NOOP : startAllDayDragWhenEditable;
  const selectSlot = readOnly ? NOOP : onSelectSlot;

  // 予定を掴んでいる間の横移動は、日付ではなくその予定を動かす操作。
  const {
    offset: swipeOffset,
    snapping: swipeSnapping,
    rootRef: swipeRootRef,
    trackRef: swipeTrackRef,
    handlers: swipeHandlers,
  } = useDaySwipe({
    daysKey: days[0],
    step: days.length,
    enabled: !dragging && !allDayDragging,
    onSwipe,
  });

  // 前後の期間。表示中と同じ日数ぶんずらして左右に並べ、指の動きに合わせて見せる。
  // 3つの期間は日付列の幅がそろって地続きに並ぶため、1列ぶんずらせば1日ぶん動く。
  const panes = useMemo<PaneDays>(
    () => [shiftDays(days, -days.length), days, shiftDays(days, days.length)],
    [days],
  );

  return (
    // touch-pan-y は、縦スクロールはブラウザに任せつつ横の動きだけをこちらで受け取るための指定。
    // これが無いと、指を横へ動かした時点でブラウザがジェスチャーを持っていってしまう。
    <div
      ref={swipeRootRef}
      className="flex min-h-0 flex-1 touch-pan-y flex-col"
      {...swipeHandlers}
    >
      <div className="flex border-b border-outline-variant">
        <div className="w-12 shrink-0" />
        <SwipeTrack offset={swipeOffset} snapping={swipeSnapping} panes={panes}>
          {(paneDays) => <DayHeaderPane days={paneDays} todayKey={todayKey} />}
        </SwipeTrack>
      </div>

      <AllDayArea
        panes={panes}
        swipeOffset={swipeOffset}
        swipeSnapping={swipeSnapping}
        events={events}
        tasks={tasks}
        reminders={reminders}
        utils={utils}
        rowRef={allDayRowRef}
        preview={allDayPreview}
        onStartDrag={startAllDayDrag}
        onConsumeDragClick={consumeAllDayDragClick}
        onPointerMove={handleAllDayPointerMove}
        onPointerUp={handleAllDayPointerUp}
        onOpenEvent={onOpenEvent}
        onOpenTask={onOpenTask}
        onOpenReminder={onOpenReminder}
      />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div
          ref={gridRef}
          data-gutter-width="48"
          className="relative flex"
          style={{ height: HOUR_HEIGHT * 24 }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div className="relative w-12 shrink-0">
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                className={cn(
                  "type-label-small absolute right-1.5 -translate-y-1/2",
                  // 6時間ごと（0/6/12/18時）を強めて、一日の四分割が目で追えるようにする。
                  hour % 6 === 0 ? "text-on-surface" : "text-on-surface-variant",
                )}
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {hour > 0 && `${String(hour).padStart(2, "0")}:00`}
              </div>
            ))}
          </div>

          <NowLine days={days} utils={utils} />

          <SwipeTrack
            offset={swipeOffset}
            snapping={swipeSnapping}
            panes={panes}
            trackRef={swipeTrackRef}
          >
            {(paneDays, isCenter) => (
              <DayColumnsPane
                days={paneDays}
                events={events}
                tasks={tasks}
                reminders={reminders}
                utils={utils}
                // 掴んでいる予定は、表示中の期間の中でだけ動かす。
                preview={isCenter ? preview : null}
                onStartDrag={startDrag}
                onConsumeDragClick={consumeDragClick}
                onOpenEvent={onOpenEvent}
                onOpenTask={onOpenTask}
                onOpenReminder={onOpenReminder}
                onSelectSlot={selectSlot}
              />
            )}
          </SwipeTrack>
        </div>
      </div>
    </div>
  );
}

/**
 * 左右へずらす帯。表示中の期間を軸に、前後の期間をその左右へ置く。
 *
 * 高さを決めるのは表示中の期間だけにしてある。前後を通常の並びに混ぜると、
 * 隣の期間に終日予定が多いだけで終日エリアが伸び、触っていないのに画面が変わってしまう。
 */
function SwipeTrack({
  offset,
  snapping,
  panes,
  trackRef,
  children,
}: {
  offset: number;
  snapping: boolean;
  panes: PaneDays;
  /** 1期間ぶんの幅を測る先。指の移動量を「何日ぶんか」に直すために使う。 */
  trackRef?: React.Ref<HTMLDivElement>;
  children: (days: string[], isCenter: boolean) => React.ReactNode;
}) {
  return (
    <div ref={trackRef} className="relative min-w-0 flex-1 overflow-hidden">
      <div
        className="relative flex"
        style={{
          transform: `translateX(${offset * 100}%)`,
          transition: snapping ? `transform ${SWIPE_SNAP_MS}ms ${SWIPE_SNAP_EASING}` : undefined,
        }}
      >
        {/* 画面の外にある期間は読み上げ・フォーカスの対象から外す。 */}
        <div className="absolute inset-y-0 right-full w-full" inert>
          {children(panes[0], false)}
        </div>
        <div className="w-full shrink-0">{children(panes[1], true)}</div>
        <div className="absolute inset-y-0 left-full w-full" inert>
          {children(panes[2], false)}
        </div>
      </div>
    </div>
  );
}

const DayHeaderPane = memo(function DayHeaderPane({
  days,
  todayKey,
}: {
  days: string[];
  todayKey: string;
}) {
  return (
    <div className="flex">
      {days.map((dateKey) => (
        <div key={dateKey} className="flex-1 py-1.5 text-center">
          <div
            className={cn(
              "type-label-small",
              weekdayTone(dateKey) ?? "text-on-surface-variant",
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
  );
});

/**
 * 1期間ぶんの日付列。前後の期間は指を離すまで動かないため、
 * 掴んでいる最中の描き直しに巻き込まれないようメモ化する。
 */
const DayColumnsPane = memo(function DayColumnsPane({
  days,
  events,
  tasks,
  reminders,
  utils,
  preview,
  onStartDrag,
  onConsumeDragClick,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
  onSelectSlot,
}: {
  days: string[];
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
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
  onOpenReminder: (reminder: ReminderItem) => void;
  onSelectSlot: (dateKey: string, minutes: number) => void;
}) {
  return (
    <div className="flex" style={{ height: GRID_HEIGHT }}>
      {days.map((dateKey, dayIndex) => (
        <DayColumn
          key={dateKey}
          dateKey={dateKey}
          dayIndex={dayIndex}
          preview={preview}
          onStartDrag={onStartDrag}
          onConsumeDragClick={onConsumeDragClick}
          utils={utils}
          onOpenEvent={onOpenEvent}
          onOpenTask={onOpenTask}
          onOpenReminder={onOpenReminder}
          onSelectSlot={onSelectSlot}
          events={events.filter(
            (event) => !event.allDay && utils.eventCoversDay(event, dateKey),
          )}
          tasks={tasks.filter((task) => task.hasTime && utils.taskCoversDay(task, dateKey))}
          reminders={reminders.filter(
            (reminder) => reminder.hasTime && utils.itemDateKey(reminder.date) === dateKey,
          )}
        />
      ))}
    </div>
  );
});

function DayColumn({
  dateKey,
  dayIndex,
  events,
  tasks,
  reminders,
  utils,
  preview,
  onStartDrag,
  onConsumeDragClick,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
  onSelectSlot,
}: {
  dateKey: string;
  dayIndex: number;
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
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
  onOpenReminder: (reminder: ReminderItem) => void;
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
              <div className="clip-nowrap font-semibold">{event.title}</div>
              {/* 短い予定で時刻まで出すと文字が潰れるため、高さに余裕があるときだけ添える。 */}
              {height >= 40 && (
                <div className="clip-nowrap opacity-75">
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
              "type-label-small clip-nowrap max-w-[78%] rounded-xs border border-outline bg-surface-container-lowest px-1",
              task.done && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </span>
        </button>
      ))}

      {/* 日付リマインドは時刻の幅を持たないため、掴めない印（時刻の点）として置く。 */}
      {reminders.map((reminder) => (
        <ReminderMarker
          key={reminder.id}
          reminder={reminder}
          top={(utils.minutesFromMidnight(reminder.date) / MINUTES_PER_DAY) * GRID_HEIGHT}
          time={utils.formatTime(reminder.date)}
          onOpen={() => onOpenReminder(reminder)}
        />
      ))}
    </div>
  );
}

/**
 * 時刻付きの日付リマインド。日付そのものを覚えておくための項目で時間の幅を持たないため、
 * 予定・タスクと違い時間グリッド上では動かせない。押すと内容の画面を開く。
 */
function ReminderMarker({
  reminder,
  top,
  time,
  onOpen,
}: {
  reminder: ReminderItem;
  top: number;
  time: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="absolute inset-x-0 flex -translate-y-1/2 items-center gap-1 pr-1"
      style={{ top }}
      title={`${time} ${reminder.title}`}
    >
      <span aria-hidden className="h-2.5 w-0.5 shrink-0 bg-tertiary" />
      <span className="h-px flex-1 bg-tertiary/45" />
      <span className="type-label-small clip-nowrap max-w-[78%] rounded-xs border border-tertiary/40 bg-tertiary-container px-1 text-on-tertiary-container">
        {reminder.title}
      </span>
    </button>
  );
}

function AllDayArea({
  panes,
  swipeOffset,
  swipeSnapping,
  events,
  tasks,
  reminders,
  utils,
  rowRef,
  preview,
  onStartDrag,
  onConsumeDragClick,
  onPointerMove,
  onPointerUp,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
}: {
  panes: PaneDays;
  swipeOffset: number;
  swipeSnapping: boolean;
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  utils: CalendarDateUtils;
  rowRef: React.Ref<HTMLDivElement>;
  preview: AllDayDragPreview | null;
  onStartDrag: (event: React.PointerEvent, target: AllDayDragTarget) => void;
  onConsumeDragClick: () => boolean;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onOpenReminder: (reminder: ReminderItem) => void;
}) {
  return (
    <div
      ref={rowRef}
      data-gutter-width="48"
      className="flex border-b border-outline-variant bg-surface-container-low"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="type-label-small w-12 shrink-0 py-1.5 pr-2 text-right text-on-surface-variant">
        終日
      </div>

      <SwipeTrack offset={swipeOffset} snapping={swipeSnapping} panes={panes}>
        {(paneDays, isCenter) => (
          <AllDayPane
            days={paneDays}
            events={events}
            tasks={tasks}
            reminders={reminders}
            utils={utils}
            preview={isCenter ? preview : null}
            onStartDrag={onStartDrag}
            onConsumeDragClick={onConsumeDragClick}
            onOpenEvent={onOpenEvent}
            onOpenTask={onOpenTask}
            onOpenReminder={onOpenReminder}
          />
        )}
      </SwipeTrack>
    </div>
  );
}

/** 終日エリアで1本ぶんの帯。日をまたぐ予定は、表示中の期間の端で continuesBefore / continuesAfter が立つ。 */
type AllDaySegment =
  | {
      kind: "event";
      item: CalendarEventItem;
      column: number;
      span: number;
      lane: number;
      continuesBefore: boolean;
      continuesAfter: boolean;
    }
  | {
      kind: "task";
      item: TaskItem;
      column: number;
      span: 1;
      lane: number;
      continuesBefore: false;
      continuesAfter: false;
    }
  | {
      kind: "reminder";
      item: ReminderItem;
      column: number;
      span: 1;
      lane: number;
      continuesBefore: false;
      continuesAfter: false;
    };

const AllDayPane = memo(function AllDayPane({
  days,
  events,
  tasks,
  reminders,
  utils,
  preview,
  onStartDrag,
  onConsumeDragClick,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
}: {
  days: string[];
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  utils: CalendarDateUtils;
  preview: AllDayDragPreview | null;
  onStartDrag: (event: React.PointerEvent, target: AllDayDragTarget) => void;
  onConsumeDragClick: () => boolean;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onOpenReminder: (reminder: ReminderItem) => void;
}) {
  /**
   * 日をまたぐ終日予定を、日ごとに切らず1本の帯として並べる（月表示と同じ考え方）。
   * 表示中の期間の外へはみ出す側は continuesBefore / continuesAfter で「まだ続く」ことを示す。
   */
  const { segments, laneCount } = useMemo(() => {
    const position = new Map<string, number>();
    days.forEach((dateKey, index) => position.set(dateKey, index));
    const firstDay = days[0];
    const lastDay = days[days.length - 1];

    // ドラッグ中の項目は、動かした日数分ずらした状態で判定・配置する。
    const shiftedEventRange = (event: CalendarEventItem): { start: string; end: string } =>
      preview?.id === event.id
        ? {
            start: shiftDateKey(event.start, preview.deltaDays),
            end: shiftDateKey(event.end, preview.deltaDays),
          }
        : { start: event.start, end: event.end };

    const shiftedTaskDue = (task: TaskItem): string | null =>
      preview?.id === task.id && task.due
        ? shiftDateKey(task.due, preview.deltaDays)
        : task.due;

    type Raw = Omit<AllDaySegment, "lane">;
    const raw: Raw[] = [];

    for (const event of events) {
      if (!event.allDay) continue;

      const shifted = shiftedEventRange(event);
      const startKey = shifted.start;
      const endKey = shifted.end < startKey ? startKey : shifted.end;
      if (endKey < firstDay || startKey > lastDay) continue;

      const clippedStart = startKey < firstDay ? firstDay : startKey;
      const clippedEnd = endKey > lastDay ? lastDay : endKey;
      const column = position.get(clippedStart);
      const endColumn = position.get(clippedEnd);
      if (column === undefined || endColumn === undefined) continue;

      raw.push({
        kind: "event",
        item: event,
        column,
        span: endColumn - column + 1,
        continuesBefore: startKey < clippedStart,
        continuesAfter: endKey > clippedEnd,
      });
    }

    for (const task of tasks) {
      if (task.hasTime || !task.due) continue;

      const dateKey = shiftedTaskDue(task);
      if (!dateKey) continue;
      const column = position.get(dateKey);
      if (column === undefined) continue;

      raw.push({ kind: "task", item: task, column, span: 1, continuesBefore: false, continuesAfter: false });
    }

    for (const reminder of reminders) {
      if (reminder.hasTime) continue;

      const column = position.get(utils.itemDateKey(reminder.date));
      if (column === undefined) continue;

      raw.push({ kind: "reminder", item: reminder, column, span: 1, continuesBefore: false, continuesAfter: false });
    }

    // 日をまたぐ帯を先に上の段へ置く。後から来た1日ぶんの項目が、帯の空いている段へ
    // 潜り込んで帯を分断しないようにするため（continuous-month-view.tsx と同じ考え方）。
    raw.sort((a, b) => {
      const barDiff = Number(b.span > 1) - Number(a.span > 1);
      if (barDiff !== 0) return barDiff;
      if (a.column !== b.column) return a.column - b.column;
      if (a.span !== b.span) return b.span - a.span;
      return utils.compareItems(a.item, b.item);
    });

    const occupied: boolean[][] = [];
    const segments: AllDaySegment[] = [];

    for (const item of raw) {
      let lane = 0;

      for (;;) {
        if (!occupied[lane]) occupied[lane] = new Array(days.length).fill(false);
        const row = occupied[lane];

        let free = true;
        for (let column = item.column; column < item.column + item.span; column += 1) {
          if (row[column]) {
            free = false;
            break;
          }
        }

        if (free) {
          for (let column = item.column; column < item.column + item.span; column += 1) {
            row[column] = true;
          }
          break;
        }

        lane += 1;
      }

      segments.push({ ...item, lane } as AllDaySegment);
    }

    return { segments, laneCount: occupied.length };
  }, [days, events, tasks, reminders, preview, utils]);

  return (
    <div className="relative min-h-9 w-full">
      {/* 日ごとの区切り線。帯を置く格子とは別に、常に日数ぶんの列で敷いておく。 */}
      <div
        className="pointer-events-none absolute inset-0 grid"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {days.map((dateKey) => (
          <div key={dateKey} className="border-l border-outline-variant" />
        ))}
      </div>

      <div
        className="grid gap-y-0.5 py-1"
        style={{
          gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
          gridTemplateRows: laneCount > 0 ? `repeat(${laneCount}, min-content)` : undefined,
        }}
      >
        {segments.map((segment) => (
          <div
            key={segment.item.id}
            className={cn(
              "min-w-0",
              segment.continuesBefore ? "pl-0" : "pl-1",
              segment.continuesAfter ? "pr-0" : "pr-1",
            )}
            style={{
              gridColumn: `${segment.column + 1} / span ${segment.span}`,
              gridRow: segment.lane + 1,
            }}
          >
            {segment.kind === "reminder" ? (
              <AllDayReminderChip
                reminder={segment.item}
                onOpen={() => onOpenReminder(segment.item)}
              />
            ) : segment.kind === "event" ? (
              <button
                type="button"
                onPointerDown={(e) => onStartDrag(e, { kind: "event", item: segment.item })}
                onClick={() => {
                  if (onConsumeDragClick()) return;
                  onOpenEvent(segment.item);
                }}
                className={cn(
                  "clip-nowrap w-full rounded-sm border px-1.5 text-left text-[11px] leading-5 font-medium",
                  // 期間の境界で切れた続きの側は角を落とし、境界の線も引かない。切れずに続いていることを示す。
                  segment.continuesBefore && "rounded-l-none border-l-0",
                  segment.continuesAfter && "rounded-r-none border-r-0",
                  preview?.id === segment.item.id && "ring-2 ring-foreground/50",
                )}
                style={{
                  backgroundColor: eventColors(segment.item.color).background,
                  color: eventColors(segment.item.color).foreground,
                  borderColor: eventColors(segment.item.color).border,
                }}
                title={segment.item.title}
              >
                {segment.item.title}
              </button>
            ) : (
              <button
                type="button"
                onPointerDown={(e) => onStartDrag(e, { kind: "task", item: segment.item })}
                onClick={() => {
                  if (onConsumeDragClick()) return;
                  onOpenTask(segment.item);
                }}
                className={cn(
                  "type-label-small clip-nowrap flex w-full items-center gap-1 rounded-xs border border-outline bg-surface-container-lowest px-1.5 py-0.5 text-left",
                  segment.item.done && "text-muted-foreground line-through",
                  preview?.id === segment.item.id && "ring-2 ring-foreground/50",
                )}
                title={segment.item.title}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-2.5 w-0.5 shrink-0",
                    segment.item.done ? "bg-on-surface-variant/60" : "bg-primary",
                  )}
                />
                <span className="clip-nowrap">{segment.item.title}</span>
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

/**
 * 終日エリアに置く日付リマインド。押すと内容の画面を開く（docs/spec.md §9）。
 * 日付そのものを覚えておくための項目で時間の幅を持たないため、掴めるようには見せない。
 */
function AllDayReminderChip({
  reminder,
  onOpen,
}: {
  reminder: ReminderItem;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="type-label-small clip-nowrap flex w-full items-center gap-1 rounded-xs border border-tertiary/40 bg-tertiary-container px-1.5 py-0.5 text-left text-on-tertiary-container"
      title={reminder.title}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-tertiary" />
      <span className="clip-nowrap">{reminder.title}</span>
    </button>
  );
}

/** YYYY-MM-DD を日数分ずらす。UTC正午で扱い、タイムゾーンによる日付ずれを避ける。 */
function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftDays(days: string[], delta: number): string[] {
  return days.map((dateKey) => shiftDateKey(dateKey, delta));
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
      <span className="type-label-small absolute left-0 w-12 -translate-y-1/2 pr-1.5 text-right text-primary">
        {utils.formatTime(iso)}
      </span>

      <span className="absolute right-0 left-12 block h-px bg-primary" />

      <span
        className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
        style={{ left: `calc(3rem + (100% - 3rem) * ${(todayIndex + 0.5) / days.length})` }}
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
