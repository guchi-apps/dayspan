"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { weekMonthKey } from "@/lib/calendar-range";
import { cn } from "@/lib/utils";
import type { CalendarEventItem, CalendarItem, ReminderItem, TaskItem } from "@/types/calendar";

import { eventColors } from "./calendar-color";
import { isAllDayItem, type CalendarDateUtils } from "./item-layout";
import { useLongPress } from "./use-long-press";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// 週の高さは固定にする。可変にすると、月をまたいで読み込み直したときに
// スクロール位置を同じ場所へ戻せなくなるため。
const WEEK_HEIGHT = 112;

// 帯を置ける段数。段の高さ（18/19px）×3段 ＋「ほか N件」1段 が、
// 日付ボタンの下に残る高さ（WEEK_HEIGHT - 32 - 下余白）に収まる上限。
const LANES = 3;

/**
 * 週の中での1本ぶんの帯。日をまたぐ予定は、週の境界で切って週ごとに1本にする。
 * 週をまたぐ側の端は continuesBefore / continuesAfter で「まだ続く」ことを示す。
 */
type WeekSegment = {
  item: CalendarItem;
  /** 週の中の列（0〜6） */
  column: number;
  /** 何列ぶんか（1〜7） */
  span: number;
  /** 上から何段目に置くか */
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

type WeekLayout = {
  segments: WeekSegment[];
  /** 列ごとの、段に入りきらなかった件数 */
  hiddenByColumn: number[];
};

/** 日をまたぐ予定・終日予定を先に、上の段へ置く。時刻のある予定はその下を埋める。 */
function isBar(segment: { item: CalendarItem; span: number }): boolean {
  return segment.span > 1 || isAllDayItem(segment.item);
}

// サーバー描画では useLayoutEffect は動かず警告になる。スクロール位置の補正は
// 画面に出る前に済ませないとガタつくため、ブラウザでだけレイアウト効果を使う。
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// 読み込み中に見せる帯。実際の予定と同じ位置・同じ高さに置き、埋まったときに形が動かないようにする。
const PENDING_BARS = [
  { column: 1, span: 3, lane: 1 },
  { column: 5, span: 2, lane: 2 },
];

function clampWeekIndex(index: number, length: number): number {
  return Math.min(Math.max(index, 0), length - 1);
}

/**
 * スクロールが止まったとみなすまでの待ち時間。
 *
 * 窓を張り直すと画面より上の週が増減するため、見ていた位置へ scrollTop を書き戻す必要がある。
 * この書き戻しは、指でなぞっている最中や惰性で流れている最中には効かない（進行中の
 * スクロールに上書きされる）。止まったことを確かめてから張り直す。
 */
const SETTLE_DELAY = 150;

export function ContinuousMonthView({
  weeks,
  events,
  tasks,
  reminders,
  weekStartsOn,
  utils,
  scrollTarget,
  pendingMonths,
  onVisibleMonthChange,
  onVisibleWeekChange,
  onScrollSettle,
  onSelectDay,
  onQuickAdd,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
}: {
  weeks: string[][];
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  weekStartsOn: number;
  utils: CalendarDateUtils;
  /**
   * 位置合わせの指示。同じ指定を続けても効くよう nonce を持たせる。
   * day を指定するとその日を含む週へ、無指定なら month の最初の週へ合わせる。
   */
  scrollTarget: { month: string; day?: string; nonce: number };
  /** まだ取得できていない月。予定が無いのか読み込み中なのかを描き分けるために使う。 */
  pendingMonths: ReadonlySet<string>;
  onVisibleMonthChange: (monthKey: string) => void;
  /** 画面の一番上にある週が変わったとき。 */
  onVisibleWeekChange: (weekKey: string) => void;
  /**
   * スクロールが止まったとき。そのとき見えている月を渡す。
   * 窓の張り直しは位置の書き戻しを伴うため、動いている最中ではなくここで行う。
   */
  onScrollSettle: (monthKey: string) => void;
  onSelectDay: (dateKey: string) => void;
  /** その日に予定を足す。指・ペンでの長押しから呼ばれる。 */
  onQuickAdd: (dateKey: string) => void;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onOpenReminder: (reminder: ReminderItem) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const visibleMonthRef = useRef(scrollTarget.month);
  const visibleWeekRef = useRef(weeks[0][0]);
  const [todayKey] = useState(() => utils.todayKey());

  // 日のセルは、押せばその日の時間グリッドへ移り、長押しならその日へ予定を足す。
  const dayPress = useLongPress<string>({ onPress: onSelectDay, onLongPress: onQuickAdd });

  // 画面の先頭にある週。窓を張り直したあと、同じ位置へ戻すために覚えておく。
  const anchorRef = useRef<{ weekKey: string; offset: number } | null>(null);
  const appliedTargetRef = useRef(-1);

  /*
   * 通知先は ref 越しに呼ぶ。
   *
   * これらは呼び出し側で毎回作り直される。そのまま useCallback / 効果の依存に入れると、
   * 画面のどこかが再描画されるたびに位置合わせの効果まで走り、スクロールの最中に
   * scrollTop を書き戻して指の動きと競合する。
   */
  const notifyRef = useRef({ onVisibleMonthChange, onVisibleWeekChange, onScrollSettle });
  useIsomorphicLayoutEffect(() => {
    notifyRef.current = { onVisibleMonthChange, onVisibleWeekChange, onScrollSettle };
  });

  // スクロールが止まるのを待つためのタイマーと、指が触れているかどうか。
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchingRef = useRef(false);

  /**
   * 週ごとの配置を先に決めておく。
   *
   * 日ごとに全アイテムを走査すると、表示日数×アイテム数の突き合わせが描画のたびに走る。
   * 月表示は前後2ヶ月ぶんを並べるため、ダイアログを開くだけの再描画でも同じ計算をやり直し、
   * 操作が返ってこなくなる。予定とタスクが変わったときだけ組み直す。
   */
  const layoutByWeek = useMemo<WeekLayout[]>(() => {
    // 日付キーから「何週目の何列目か」を引けるようにする。
    const position = new Map<string, [number, number]>();
    weeks.forEach((week, weekIndex) => {
      week.forEach((dateKey, column) => position.set(dateKey, [weekIndex, column]));
    });

    // 画面に無い日まで展開しても捨てるだけなので、表示範囲で頭打ちにする
    // （日付が壊れていても、ここで必ず止まる）。
    const firstDay = weeks[0][0];
    const lastDay = weeks[weeks.length - 1][6];

    type RawSegment = Omit<WeekSegment, "lane">;
    const rawByWeek: RawSegment[][] = weeks.map(() => []);

    const push = (
      startKey: string,
      endKey: string,
      item: CalendarItem,
    ) => {
      if (endKey < firstDay || startKey > lastDay) return;

      const clippedStart = startKey < firstDay ? firstDay : startKey;
      const clippedEnd = endKey > lastDay ? lastDay : endKey;
      if (clippedStart > clippedEnd) return;

      const from = position.get(clippedStart);
      const to = position.get(clippedEnd);
      if (!from || !to) return;

      const [startWeek, startColumn] = from;
      const [endWeek, endColumn] = to;

      for (let weekIndex = startWeek; weekIndex <= endWeek; weekIndex += 1) {
        const column = weekIndex === startWeek ? startColumn : 0;
        const last = weekIndex === endWeek ? endColumn : 6;

        rawByWeek[weekIndex].push({
          item,
          column,
          span: last - column + 1,
          continuesBefore: weekIndex > startWeek || startKey < clippedStart,
          continuesAfter: weekIndex < endWeek || endKey > clippedEnd,
        });
      }
    };

    for (const event of events) {
      const startKey = utils.itemDateKey(event.start);
      const endKey = utils.itemDateKey(event.end);
      push(startKey, endKey < startKey ? startKey : endKey, event);
    }

    for (const task of tasks) {
      if (!task.due) continue;
      const dateKey = utils.itemDateKey(task.due);
      push(dateKey, dateKey, task);
    }

    for (const reminder of reminders) {
      const dateKey = utils.itemDateKey(reminder.date);
      push(dateKey, dateKey, reminder);
    }

    return rawByWeek.map((raw) => {
      raw.sort((a, b) => {
        // 帯（日をまたぐ・終日）を先に置く。後から来た1日ぶんの予定が、
        // 帯の空いている段へ潜り込んで帯を分断しないようにするため。
        const barDiff = Number(isBar(b)) - Number(isBar(a));
        if (barDiff !== 0) return barDiff;
        if (a.column !== b.column) return a.column - b.column;
        if (a.span !== b.span) return b.span - a.span;
        return utils.compareItems(a.item, b.item);
      });

      // 段ごとに、どの列が埋まっているかを持つ。帯は span ぶん連続して空いている段に入れる。
      const occupied: boolean[][] = [];
      const segments: WeekSegment[] = [];
      const hiddenByColumn = new Array(7).fill(0);

      for (const raw_ of raw) {
        let lane = 0;

        for (;;) {
          if (!occupied[lane]) occupied[lane] = new Array(7).fill(false);
          const row = occupied[lane];

          let free = true;
          for (let column = raw_.column; column < raw_.column + raw_.span; column += 1) {
            if (row[column]) {
              free = false;
              break;
            }
          }

          if (free) {
            for (let column = raw_.column; column < raw_.column + raw_.span; column += 1) {
              row[column] = true;
            }
            break;
          }

          lane += 1;
        }

        if (lane < LANES) {
          segments.push({ ...raw_, lane });
        } else {
          for (let column = raw_.column; column < raw_.column + raw_.span; column += 1) {
            hiddenByColumn[column] += 1;
          }
        }
      }

      return { segments, hiddenByColumn };
    });
  }, [events, tasks, reminders, utils, weeks]);

  const rememberAnchor = useCallback(
    (container: HTMLDivElement) => {
      const index = clampWeekIndex(Math.floor(container.scrollTop / WEEK_HEIGHT), weeks.length);
      const weekKey = weeks[index][0];

      anchorRef.current = {
        weekKey,
        offset: container.scrollTop - index * WEEK_HEIGHT,
      };

      if (weekKey !== visibleWeekRef.current) {
        visibleWeekRef.current = weekKey;
        notifyRef.current.onVisibleWeekChange(weekKey);
      }
    },
    [weeks],
  );

  /** いま見ている月。画面の上から1/3の位置にある週で決める。 */
  const monthAtScroll = useCallback(
    (container: HTMLDivElement) => {
      const index = clampWeekIndex(
        Math.floor((container.scrollTop + container.clientHeight / 3) / WEEK_HEIGHT),
        weeks.length,
      );

      return weekMonthKey(weeks[index]);
    },
    [weeks],
  );

  const cancelSettle = useCallback(() => {
    if (settleTimerRef.current === null) return;

    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = null;
  }, []);

  /** 動きが止まったら知らせる。指が触れている間は、離してから数え直す。 */
  const scheduleSettle = useCallback(() => {
    cancelSettle();

    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      if (touchingRef.current) return;

      const container = scrollRef.current;
      if (!container) return;

      notifyRef.current.onScrollSettle(monthAtScroll(container));
    }, SETTLE_DELAY);
  }, [cancelSettle, monthAtScroll]);

  useEffect(() => cancelSettle, [cancelSettle]);

  useIsomorphicLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    // 月・日を指定した移動（今日・前へ・次へ・日表示からの切り替え）は、位置の維持より優先する。
    if (scrollTarget.nonce !== appliedTargetRef.current) {
      const { day, month } = scrollTarget;
      const target = day
        ? weeks.findIndex((week) => week.includes(day))
        : weeks.findIndex((week) => weekMonthKey(week) === month);

      if (target >= 0) {
        appliedTargetRef.current = scrollTarget.nonce;
        container.scrollTop = target * WEEK_HEIGHT;
        rememberAnchor(container);
        return;
      }
    }

    // 窓を張り直すと前後の週が増減し、見ていた内容が上下にずれる。
    // 週の高さを固定にしてあるので、覚えておいた週が同じ位置に来るよう戻せる。
    const anchor = anchorRef.current;
    if (!anchor) return;

    const index = weeks.findIndex((week) => week[0] === anchor.weekKey);
    if (index < 0) return;

    container.scrollTop = index * WEEK_HEIGHT + anchor.offset;
  }, [weeks, scrollTarget, rememberAnchor]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    rememberAnchor(container);

    const month = monthAtScroll(container);

    if (month !== visibleMonthRef.current) {
      visibleMonthRef.current = month;
      notifyRef.current.onVisibleMonthChange(month);
    }

    scheduleSettle();
  }, [monthAtScroll, rememberAnchor, scheduleSettle]);

  // 指が触れている間は、離すまで「止まった」とみなさない。押している最中に窓を張り直すと、
  // 位置の書き戻しが進行中のスクロールに上書きされ、見ていた位置が数ヶ月ぶんずれる。
  const handleTouchStart = useCallback(() => {
    touchingRef.current = true;
    cancelSettle();
  }, [cancelSettle]);

  const handleTouchEnd = useCallback(() => {
    touchingRef.current = false;
    scheduleSettle();
  }, [scheduleSettle]);

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
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        // ブラウザのネイティブ scroll anchoring は無効にし、窓を張り直したときの位置合わせを
        // 上の useIsomorphicLayoutEffect だけに任せる。両方が動くと、どちらの結果が残るかが
        // ブラウザ任せになり、ずれたときに原因を追えないため。
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
      >
        {weeks.map((week, weekIndex) => {
          const { segments, hiddenByColumn } = layoutByWeek[weekIndex];
          // 未取得の月をただの空白で描くと「予定が無い」と読めてしまう。
          const pending = pendingMonths.has(weekMonthKey(week));

          return (
            <div
              key={week[0]}
              className="relative grid grid-cols-7 border-b border-outline-variant"
              style={{ height: WEEK_HEIGHT }}
            >
              {week.map((dateKey) => {
                const isFirstOfMonth = dateKey.slice(8, 10) === "01";

                return (
                  <div
                    key={dateKey}
                    className="relative flex min-w-0 flex-col border-r border-outline-variant p-0.5 last:border-r-0 sm:p-1"
                  >
                    {/*
                      日付の数字だけでなく、日のどこを押しても移動できるようにする。
                      予定の帯はこのセルの上に重ねて描いているため、帯を押したときに
                      こちらへ抜けることはない。
                    */}
                    <button
                      type="button"
                      aria-label={`${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日の1日表示へ移動`}
                      className="absolute inset-0 cursor-default select-none"
                      {...dayPress(dateKey)}
                    />

                    {/* 重ねた面より後ろに沈まないよう、数字の側も配置対象にしておく。 */}
                    <button
                      type="button"
                      className={cn(
                        "relative grid h-7 min-w-7 shrink-0 place-items-center self-start rounded-full px-2 text-[11px] select-none sm:h-6 sm:min-w-6 sm:px-1.5 sm:text-xs",
                        dateKey === todayKey
                          ? "bg-primary font-semibold text-primary-foreground"
                          : "font-medium hover:bg-muted",
                      )}
                      {...dayPress(dateKey)}
                    >
                      {/* 月替わりは日付の並びだけでは分からないため、1日にだけ月を添える。 */}
                      {isFirstOfMonth
                        ? `${Number(dateKey.slice(5, 7))}/1`
                        : Number(dateKey.slice(8, 10))}
                    </button>
                  </div>
                );
              })}

              {/*
                帯は日のセルの中ではなく、週全体に重ねた格子へ置く。セルの中に置くと
                日をまたぐ予定を1本につなげられず、日ごとに切れて見えるため。
              */}
              <div className="pointer-events-none absolute inset-x-0 top-8 bottom-0.5 grid auto-rows-[18px] grid-cols-7 overflow-hidden sm:bottom-1 sm:auto-rows-[19px]">
                {pending
                  ? PENDING_BARS.map((bar, index) => (
                      <div
                        key={index}
                        className="mx-0.5 h-4 animate-pulse rounded-xs bg-on-surface/8 sm:mx-1"
                        style={{ gridColumn: `${bar.column} / span ${bar.span}`, gridRow: bar.lane }}
                      />
                    ))
                  : segments.map((segment) => (
                      <div
                        key={`${segment.item.id}-${segment.column}`}
                        className={cn(
                          "pointer-events-auto min-w-0",
                          // 週をまたぐ側は余白を詰め、隣の週の端と地続きに見えるようにする。
                          segment.continuesBefore ? "pl-0" : "pl-0.5 sm:pl-1",
                          segment.continuesAfter ? "pr-0" : "pr-0.5 sm:pr-1",
                        )}
                        style={{
                          gridColumn: `${segment.column + 1} / span ${segment.span}`,
                          gridRow: segment.lane + 1,
                        }}
                      >
                        {renderChip(segment, utils, onOpenEvent, onOpenTask, onOpenReminder)}
                      </div>
                    ))}

                {!pending &&
                  hiddenByColumn.map((hidden, column) =>
                    hidden > 0 ? (
                      <button
                        key={week[column]}
                        type="button"
                        onClick={() => onSelectDay(week[column])}
                        className="pointer-events-auto truncate px-0.5 text-left text-[10px] whitespace-nowrap text-on-surface-variant sm:px-1 sm:hover:text-foreground"
                        style={{ gridColumn: column + 1, gridRow: LANES + 1 }}
                      >
                        <span className="sm:hidden">+{hidden}</span>
                        <span className="hidden sm:inline">ほか {hidden}件</span>
                      </button>
                    ) : null,
                  )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderChip(
  segment: WeekSegment,
  utils: CalendarDateUtils,
  onOpenEvent: (event: CalendarEventItem) => void,
  onOpenTask: (task: TaskItem) => void,
  onOpenReminder: (reminder: ReminderItem) => void,
) {
  const item = segment.item;

  if (item.kind === "event") {
    return (
      <EventChip
        event={item}
        utils={utils}
        continuesBefore={segment.continuesBefore}
        continuesAfter={segment.continuesAfter}
        onOpen={() => onOpenEvent(item)}
      />
    );
  }

  if (item.kind === "reminder") {
    return <ReminderChip reminder={item} utils={utils} onOpen={() => onOpenReminder(item)} />;
  }

  return <TaskChip task={item} utils={utils} onOpen={() => onOpenTask(item)} />;
}

function ReminderChip({
  reminder,
  utils,
  onOpen,
}: {
  reminder: ReminderItem;
  utils: CalendarDateUtils;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="type-label-small flex h-[17px] w-full min-w-0 items-center gap-1 overflow-hidden rounded-xs border border-tertiary/40 bg-tertiary-container px-1 text-left text-[10px] leading-[15px] font-medium text-on-tertiary-container sm:h-[18px] sm:text-[11px] sm:leading-4"
      title={reminder.title}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-tertiary" />
      {reminder.hasTime && (
        <span className="hidden shrink-0 opacity-70 sm:inline">{utils.formatTime(reminder.date)}</span>
      )}
      <span className="clip-nowrap">{reminder.title}</span>
    </button>
  );
}

/** 予定は占有した時間の「幅」。塗りつぶした帯で表す。 */
function EventChip({
  event,
  utils,
  continuesBefore,
  continuesAfter,
  onOpen,
}: {
  event: CalendarEventItem;
  utils: CalendarDateUtils;
  continuesBefore: boolean;
  continuesAfter: boolean;
  onOpen: () => void;
}) {
  const colors = eventColors(event.color);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "type-label-small flex h-[17px] w-full min-w-0 items-center gap-1 overflow-hidden rounded-xs border px-1 text-left text-[10px] leading-[15px] font-medium sm:h-[18px] sm:text-[11px] sm:leading-4",
        // 週をまたぐ側は角を落とし、境界の線も引かない。切れずに続いていることを示す。
        continuesBefore && "rounded-l-none border-l-0",
        continuesAfter && "rounded-r-none border-r-0",
      )}
      style={{
        backgroundColor: colors.background,
        color: colors.foreground,
        borderColor: colors.border,
      }}
      title={event.title}
    >
      {/* 開始時刻は実際に始まる日にだけ添える。続きの側に出すと、その日に始まったように読めるため。 */}
      {!event.allDay && !continuesBefore && (
        <span className="hidden shrink-0 opacity-75 sm:inline">
          {utils.formatTime(event.start)}
        </span>
      )}
      {/*
        週の境界で切れた続きの側にもタイトルを出す。その週だけを見ている人には
        前の週の帯が見えず、名前の無い帯だけが残ってしまうため。
      */}
      <span className="clip-nowrap">{event.title}</span>
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
        "type-label-small flex h-[17px] w-full min-w-0 items-center gap-1 overflow-hidden rounded-xs border border-outline bg-surface-container-lowest px-1 text-left text-[10px] leading-[15px] font-medium sm:h-[18px] sm:text-[11px] sm:leading-4",
        task.done && "text-on-surface-variant line-through",
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
      <span className="clip-nowrap">{task.title}</span>
    </button>
  );
}
