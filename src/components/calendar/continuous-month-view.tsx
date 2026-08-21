"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { addDays, parseDateKey, toDateKey, weekMonthKey, weeksBetween } from "@/lib/calendar-range";
import { cn } from "@/lib/utils";
import type {
  CalendarEventItem,
  CalendarItem,
  ReminderItem,
  TaskItem,
  TravelItem,
} from "@/types/calendar";

import { eventColors } from "./calendar-color";
import {
  isAllDayItem,
  reminderAnnualYearLabel,
  reminderAnnualYearShortLabel,
  taskOccurrences,
  type CalendarDateUtils,
  type TaskDateField,
} from "./item-layout";
import { ReminderMark } from "./reminder-mark";
import { taskLinkFullLabel } from "./task-link-label";
import { TaskStageMark } from "./task-stage-mark";
import { TravelMark } from "./travel-mark";
import { useLongPress } from "./use-long-press";
import { useScrollbarGutter } from "./use-scrollbar-gutter";
import { useWeekZoom } from "./use-week-zoom";

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

// 時間グリッドのピンチ（use-time-zoom.ts）は、始まった時点で掴みかけの予定ドラッグを
// 取りやめるために onPinchStart を使う。月表示にドラッグは無いため何もしない。
const NOOP = () => {};

// 週の高さは、1日・3日表示の時間幅と同じく2本指のピンチで変えられる（use-week-zoom.ts）。
// 全ての週に同じ高さを一律に適用するため、週をまたいで窓を張り直しても、通し位置
// （絶対週インデックス）と高さの掛け算のままスクロール位置が求まる。

// 帯を置ける段数。段の高さ（18/19px）に応じて動的に計算する。
// ピンチで高さを変えたときに表示できるアイテムを増やすため、weekHeight に応じて
// 計算可能な段数を使う。配置計算（layoutByWeek）は memoized なので、
// weekHeight が変わらない限りピンチ中に再計算は走らない。
function calculateLanes(weekHeight: number): number {
  // 各段の高さ（クラスで auto-rows-[18px] または auto-rows-[19px]）
  const itemHeight = 18;
  // 日付ボタン（h-7 sm:h-6 = 28px/24px）+ 下余白（0.5 or 1 = 2/4px）+ 上余白
  // の合計約32-36px。保守性のため、固定値ではなく計算ベースで求める。
  const reservedHeight = 36;
  // 利用可能な高さから、表示可能な段数を計算する
  const availableHeight = weekHeight - reservedHeight;
  const maxLanes = Math.max(1, Math.floor(availableHeight / itemHeight));
  // 最初は3段が目安（既定の見た目）だが、拡大されたら段数を増やす
  return maxLanes;
}

function lanesForHeight(weekHeight: number): number {
  return calculateLanes(weekHeight);
}

/**
 * 週の中での1本ぶんの帯。日をまたぐ予定は、週の境界で切って週ごとに1本にする。
 * 週をまたぐ側の端は continuesBefore / continuesAfter で「まだ続く」ことを示す。
 */
type WeekSegment = {
  item: CalendarItem;
  /** タスクのとき、期限と予定日のどちらの枠か（docs/spec.md §5）。 */
  taskField?: TaskDateField;
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
function isBar(segment: { item: CalendarItem; taskField?: TaskDateField; span: number }): boolean {
  return segment.span > 1 || isAllDayItem(segment.item, segment.taskField);
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

const VOID_BACKGROUND_IMAGE = [
  "linear-gradient(to bottom, transparent calc(100% - 1px), var(--color-outline-variant) 0)",
  "linear-gradient(to right, transparent calc(100% - 1px), var(--color-outline-variant) 0)",
].join(", ");

/**
 * 窓の外側に置く余白。まだ日付を並べていない範囲。
 *
 * 何も描かないと、勢いよくスクロールして窓の先へ出たときにカレンダーが途切れて見える。
 * 週と日の区切り線だけを背景で描き、日付の入っていないカレンダーとして見せる。
 * 区切り線の間隔は週の高さで決まるため、ピンチで高さが変わるたびに求め直す。
 */
function voidStyle(weekHeight: number): CSSProperties {
  return {
    backgroundImage: VOID_BACKGROUND_IMAGE,
    backgroundSize: `100% ${weekHeight}px, calc(100% / 7) 100%`,
  };
}

export function ContinuousMonthView({
  weeks,
  events,
  tasks,
  reminders,
  travels,
  weekStartsOn,
  utils,
  scrollTarget,
  pendingMonths,
  virtual,
  onVisibleMonthChange,
  onVisibleWeekChange,
  onSelectDay,
  onQuickAdd,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
  onOpenTravel,
}: {
  weeks: string[][];
  events: CalendarEventItem[];
  tasks: TaskItem[];
  reminders: ReminderItem[];
  travels: TravelItem[];
  weekStartsOn: number;
  utils: CalendarDateUtils;
  /**
   * 位置合わせの指示。同じ指定を続けても効くよう nonce を持たせる。
   * day を指定するとその日を含む週へ、無指定なら month の最初の週へ合わせる。
   */
  scrollTarget: { month: string; day?: string; nonce: number };
  /** まだ取得できていない月。予定が無いのか読み込み中なのかを描き分けるために使う。 */
  pendingMonths: ReadonlySet<string>;
  /**
   * スクロールできる範囲。weeks（描く窓）より広く、その外側は日付を並べない余白になる。
   *
   * 窓を張り直しても、余白が同じぶん増減して各週の位置を据え置く。位置が動かないので、
   * スクロールの最中に張り直しても見ていた場所がずれない。
   */
  virtual: { firstWeekKey: string; weekCount: number };
  onVisibleMonthChange: (monthKey: string) => void;
  /**
   * 画面中央にある週が変わったとき。
   * 表示形式を切り替える操作の起点にする週なので、上端ではなく中央を採る。
   */
  onVisibleWeekChange: (weekKey: string) => void;
  onSelectDay: (dateKey: string) => void;
  /** その日に予定を足す。指・ペンでの長押しから呼ばれる。 */
  onQuickAdd: (dateKey: string) => void;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onOpenReminder: (reminder: ReminderItem) => void;
  onOpenTravel: (travel: TravelItem) => void;
}) {
  // ピンチ直後に残るclickやピンチ中の長押しを無視するためのフラグ。use-week-zoom.ts の
  // consumePinchClick を、長押しタイマーの発火時にも古い判定値を読まないようrefで持つ
  // （タイマーはpointerdown時点のonLongPressを掴んだまま数百ms後に発火するため、
  // useCallbackの依存越しに渡すと発火時点の最新のピンチ状態を読めない）。
  const consumePinchClickRef = useRef<() => boolean>(() => false);

  // 日のセルは、押せばその日の時間グリッドへ移り、長押しならその日へ予定を足す。
  const dayPress = useLongPress<string>({
    onPress: (dateKey) => {
      if (!consumePinchClickRef.current()) onSelectDay(dateKey);
    },
    onLongPress: (dateKey) => {
      if (!consumePinchClickRef.current()) onQuickAdd(dateKey);
    },
  });

  const { weekHeight, scrollRef, consumePinchClick } = useWeekZoom({ onPinchStart: NOOP });
  useIsomorphicLayoutEffect(() => {
    consumePinchClickRef.current = consumePinchClick;
  });

  const scrollbarGutter = useScrollbarGutter(scrollRef);
  const visibleMonthRef = useRef(scrollTarget.month);
  const visibleWeekRef = useRef(weeks[0][0]);
  const [todayKey] = useState(() => utils.todayKey());

  /*
   * 画面の先頭にある週。並びの中の位置ではなく、余白も含めた通し位置（absIndex）で覚える。
   *
   * 窓を張り直しただけなら通し位置は変わらないため、書き戻しは何もせずに済む。
   * サーバー描画のあと余白を出すときのように、通し位置そのものが動いたときだけ戻す。
   */
  const anchorRef = useRef<{ weekKey: string; absIndex: number; offset: number } | null>(null);
  const appliedTargetRef = useRef(-1);

  /*
   * 余白はブラウザでだけ出す。
   *
   * サーバー描画の時点で余白を入れると、まだ位置合わせが走っていない（scrollTop が 0 の）
   * 画面には余白だけが映り、カレンダーが空に見える。最初の描画は窓だけにしておく。
   */
  const [spacersReady, setSpacersReady] = useState(false);
  useIsomorphicLayoutEffect(() => setSpacersReady(true), []);

  /**
   * 並べたものの高さ方向の座標。先頭週（originWeekKey）から数えた通し番号で位置を決める。
   *
   * 窓ではなくこの座標で見ている場所を求めるため、余白の奥まで一気に飛ばされても、
   * そこがどの月かを一度で言い当てられる（窓の端で頭打ちにすると、窓が追いつくまで
   * 何度も張り直すことになる）。
   */
  const geometry = useMemo(() => {
    const lead = spacersReady ? weeksBetween(virtual.firstWeekKey, weeks[0][0]) : 0;

    // 余白の外まで動いた場合（何年も指で送り続けたとき）は、余白を諦めて窓だけを描く。
    if (lead < 0 || lead + weeks.length > virtual.weekCount) {
      return { originWeekKey: weeks[0][0], totalWeeks: weeks.length, lead: 0 };
    }

    return {
      originWeekKey: spacersReady ? virtual.firstWeekKey : weeks[0][0],
      totalWeeks: spacersReady ? virtual.weekCount : weeks.length,
      lead,
    };
  }, [spacersReady, virtual, weeks]);

  const trail = geometry.totalWeeks - geometry.lead - weeks.length;

  /*
   * 通知先は ref 越しに呼ぶ。
   *
   * これらは呼び出し側で毎回作り直される。そのまま useCallback / 効果の依存に入れると、
   * 画面のどこかが再描画されるたびに位置合わせの効果まで走り、スクロールの最中に
   * scrollTop を書き戻して指の動きと競合する。
   */
  const notifyRef = useRef({ onVisibleMonthChange, onVisibleWeekChange });
  useIsomorphicLayoutEffect(() => {
    notifyRef.current = { onVisibleMonthChange, onVisibleWeekChange };
  });

  /**
   * 週ごとの配置を先に決めておく。
   *
   * 日ごとに全アイテムを走査すると、表示日数×アイテム数の突き合わせが描画のたびに走る。
   * 月表示は前後2ヶ月ぶんを並べるため、ダイアログを開くだけの再描画でも同じ計算をやり直し、
   * 操作が返ってこなくなる。予定とタスクが変わったときだけ組み直す。
   */
  const layoutByWeek = useMemo<WeekLayout[]>(() => {
    const lanes = lanesForHeight(weekHeight);
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
      taskField?: TaskDateField,
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
          taskField,
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

    // 期限と予定日はそれぞれ別の枠として置く。同じタスクでも意味が違うため、
    // 片方に寄せず、それぞれの日で描き分ける（docs/spec.md §5）。
    for (const task of tasks) {
      for (const occurrence of taskOccurrences(task)) {
        const dateKey = utils.itemDateKey(occurrence.date);
        push(dateKey, dateKey, task, occurrence.field);
      }
    }

    for (const reminder of reminders) {
      const dateKey = utils.itemDateKey(reminder.date);
      push(dateKey, dateKey, reminder);
    }

    // 移動は日をまたぐこともある（夜行バス・飛行機）。予定と同じく、かかる日すべてに置く。
    for (const travel of travels) {
      const startKey = utils.itemDateKey(travel.start);
      const endKey = utils.itemDateKey(travel.end);
      push(startKey, endKey < startKey ? startKey : endKey, travel);
    }

    return rawByWeek.map((raw) => {
      raw.sort((a, b) => {
        // 帯（日をまたぐ・終日）を先に置く。後から来た1日ぶんの予定が、
        // 帯の空いている段へ潜り込んで帯を分断しないようにするため。
        const barDiff = Number(isBar(b)) - Number(isBar(a));
        if (barDiff !== 0) return barDiff;
        if (a.column !== b.column) return a.column - b.column;
        if (a.span !== b.span) return b.span - a.span;
        return utils.compareItems(a, b);
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

        if (lane < lanes) {
          segments.push({ ...raw_, lane });
        } else {
          for (let column = raw_.column; column < raw_.column + raw_.span; column += 1) {
            hiddenByColumn[column] += 1;
          }
        }
      }

      return { segments, hiddenByColumn };
    });
  }, [events, tasks, reminders, travels, utils, weeks, weekHeight]);

  /** その高さにある週の先頭日。余白の中でも、窓の外の週として答える。 */
  const weekKeyAt = useCallback(
    (top: number) => {
      const index = clampWeekIndex(Math.floor(top / weekHeight), geometry.totalWeeks);
      return toDateKey(addDays(parseDateKey(geometry.originWeekKey), index * 7));
    },
    [geometry, weekHeight],
  );

  const rememberAnchor = useCallback(
    (container: HTMLDivElement) => {
      const absIndex = clampWeekIndex(
        Math.floor(container.scrollTop / weekHeight),
        geometry.totalWeeks,
      );
      const weekKey = toDateKey(addDays(parseDateKey(geometry.originWeekKey), absIndex * 7));

      anchorRef.current = {
        weekKey,
        absIndex,
        offset: container.scrollTop - absIndex * weekHeight,
      };

      // 表示形式を切り替えたときの移動先には画面中央にある週を使う。上端の週だと、
      // 半分だけ見えている週を移動先に選ぶことになり、いま読んでいた内容とずれるため。
      const centerWeekKey = weekKeyAt(container.scrollTop + container.clientHeight / 2);
      if (centerWeekKey !== visibleWeekRef.current) {
        visibleWeekRef.current = centerWeekKey;
        notifyRef.current.onVisibleWeekChange(centerWeekKey);
      }
    },
    [geometry, weekHeight, weekKeyAt],
  );

  /** いま見ている月。画面の上から1/3の位置にある週の、中日（4日目）の月を採る。 */
  const monthAtScroll = useCallback(
    (container: HTMLDivElement) => {
      const weekKey = weekKeyAt(container.scrollTop + container.clientHeight / 3);
      return toDateKey(addDays(parseDateKey(weekKey), 3)).slice(0, 7);
    },
    [weekKeyAt],
  );

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

        // day を指定した移動（今日・日表示からの切り替え）は、その週を画面中央へ置く。
        // 上端に揃えるだけだと、指定した日が画面の外や端に埋もれて見えることがあるため。
        // month だけの指定（前へ・次へ）は、従来どおりその月の先頭週を上端に揃える。
        container.scrollTop = day
          ? (geometry.lead + target) * weekHeight - (container.clientHeight - weekHeight) / 2
          : (geometry.lead + target) * weekHeight;
        rememberAnchor(container);
        return;
      }
    }

    // 覚えておいた週の通し位置が動いていれば、その差だけ戻す。窓を張り直しただけなら
    // 余白が同じぶん減る（増える）ので差は0になり、ここでは何もしない。
    const anchor = anchorRef.current;
    if (!anchor) return;

    const absIndex = weeksBetween(geometry.originWeekKey, anchor.weekKey);
    if (absIndex === anchor.absIndex) return;

    container.scrollTop += (absIndex - anchor.absIndex) * weekHeight;
    anchorRef.current = { ...anchor, absIndex };
  }, [geometry, weeks, scrollTarget, rememberAnchor, weekHeight]);

  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    rememberAnchor(container);

    const month = monthAtScroll(container);

    if (month !== visibleMonthRef.current) {
      visibleMonthRef.current = month;
      notifyRef.current.onVisibleMonthChange(month);
    }
  }, [monthAtScroll, rememberAnchor, scrollRef]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 曜日の見出しはスクロール領域の外にある。パソコンのスクロールバーは場所を取るため、
          同じ幅を右へ空けないと下の日付セルと列の境目がずれる（issue #136）。 */}
      <div
        className="grid shrink-0 grid-cols-7 border-b border-outline-variant"
        style={{ paddingRight: scrollbarGutter }}
      >
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
        // ブラウザのネイティブ scroll anchoring は無効にし、窓を張り直したときの位置合わせを
        // 上の useIsomorphicLayoutEffect だけに任せる。両方が動くと、どちらの結果が残るかが
        // ブラウザ任せになり、ずれたときに原因を追えないため。
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
      >
        {geometry.lead > 0 && (
          <div aria-hidden style={{ ...voidStyle(weekHeight), height: geometry.lead * weekHeight }} />
        )}

        {weeks.map((week, weekIndex) => {
          const { segments, hiddenByColumn } = layoutByWeek[weekIndex];
          // 未取得の月をただの空白で描くと「予定が無い」と読めてしまう。
          const pending = pendingMonths.has(weekMonthKey(week));

          return (
            <div
              key={week[0]}
              className="relative grid grid-cols-7 border-b border-outline-variant"
              style={{ height: weekHeight }}
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
                {(() => {
                  const lanes = lanesForHeight(weekHeight);
                  return (
                    <>
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
                              // 期限と予定日が同じ列に並ぶこともあるため、どちらの枠かまで含めて区別する。
                              key={`${segment.item.id}-${segment.taskField ?? ""}-${segment.column}`}
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
                              {renderChip(segment, utils, onOpenEvent, onOpenTask, onOpenReminder, onOpenTravel)}
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
                              style={{ gridColumn: column + 1, gridRow: lanes + 1 }}
                            >
                              <span className="sm:hidden">+{hidden}</span>
                              <span className="hidden sm:inline">ほか {hidden}件</span>
                            </button>
                          ) : null,
                        )}
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })}

        {trail > 0 && (
          <div aria-hidden style={{ ...voidStyle(weekHeight), height: trail * weekHeight }} />
        )}
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
  onOpenTravel: (travel: TravelItem) => void,
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

  if (item.kind === "travel") {
    return (
      <TravelChip
        travel={item}
        utils={utils}
        continuesBefore={segment.continuesBefore}
        onOpen={() => onOpenTravel(item)}
      />
    );
  }

  return (
    <TaskChip
      task={item}
      field={segment.taskField ?? "due"}
      utils={utils}
      onOpen={() => onOpenTask(item)}
    />
  );
}

/**
 * 日付リマインドは完了して消化するタスクとは別物。塗りつぶさず、菱形の印で
 * 予定・タスクと描き分ける（docs/spec.md §9）。
 *
 * 年目のラベルは項目名と同じ1つの文字列として流す。別の要素に分けて縮まないようにすると、
 * 枠が狭いときに名前のほうが削られ、年目だけが残って何の項目か読めなくなるため（issue #171）。
 */
function ReminderChip({
  reminder,
  utils,
  onOpen,
}: {
  reminder: ReminderItem;
  utils: CalendarDateUtils;
  onOpen: () => void;
}) {
  const yearLabel = reminderAnnualYearShortLabel(reminder);
  const fullYearLabel = reminderAnnualYearLabel(reminder);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="type-label-small flex h-[17px] w-full min-w-0 items-center gap-1 overflow-hidden rounded-xs border border-tertiary/60 bg-surface-container-lowest px-1 text-left text-[9px] leading-[15px] font-medium sm:h-[18px] sm:text-[10px] sm:leading-4"
      title={fullYearLabel ? `${reminder.title} ${fullYearLabel}` : reminder.title}
    >
      <ReminderMark source={reminder.source} />
      {reminder.hasTime && (
        <span className="hidden shrink-0 opacity-70 sm:inline">{utils.formatTime(reminder.date)}</span>
      )}
      <span className="clip-nowrap">
        {reminder.title}
        {yearLabel && <span className="opacity-70"> {yearLabel}</span>}
      </span>
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
        "type-label-small flex h-[17px] w-full min-w-0 items-center gap-1 overflow-hidden rounded-xs border px-1 text-left text-[9px] leading-[15px] font-medium sm:h-[18px] sm:text-[10px] sm:leading-4",
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

/**
 * タスクは期限という「点」。塗らず、先頭に目盛りを立てて予定と描き分ける（docs/spec.md §5）。
 *
 * 予定日の枠は、同じ形のまま枠線を破線・目盛りを薄くして描く。締切ではなく見込みであることを
 * 一目で分けるためで、別の形にしないのは同じタスクの枠だと分かるようにするため。
 */
function TaskChip({
  task,
  field,
  utils,
  onOpen,
}: {
  task: TaskItem;
  field: TaskDateField;
  utils: CalendarDateUtils;
  onOpen: () => void;
}) {
  const planned = field === "planned";
  const date = planned ? task.planned : task.due;
  const hasTime = planned ? task.plannedHasTime : task.hasTime;
  // 紐づけの印は予定日の枠にだけ出す。紐づけから決まるのは予定日で、期限は利用者が
  // 自分で決めた締切のまま動かないため（docs/spec.md §31）。
  const link = planned ? task.link : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "type-label-small flex h-[17px] w-full min-w-0 items-center gap-1 overflow-hidden rounded-xs border border-outline bg-surface-container-lowest px-1 text-left text-[9px] leading-[15px] font-medium sm:h-[18px] sm:text-[10px] sm:leading-4",
        planned && "border-dashed",
        task.done && "text-on-surface-variant line-through",
      )}
      title={
        link
          ? `${taskLinkFullLabel(link)}: ${task.title}`
          : planned
            ? `予定日: ${task.title}`
            : task.title
      }
    >
      {link ? (
        <TaskStageMark stage={link.stage} drifted={link.drifted} className="h-2 w-2.5" />
      ) : (
        <span
          aria-hidden
          className={cn(
            "h-2.5 w-0.5 shrink-0",
            task.done ? "bg-on-surface-variant/60" : planned ? "bg-primary/40" : "bg-primary",
          )}
        />
      )}
      {hasTime && date && (
        <span className="hidden shrink-0 opacity-70 sm:inline">{utils.formatTime(date)}</span>
      )}
      <span className="clip-nowrap">{task.title}</span>
    </button>
  );
}

/**
 * 移動は塗らず、矢印の印と行き先だけを出す（docs/spec.md §29）。
 *
 * 月表示で1日に置ける件数は限られている。移動は予定に1件ずつ付くため、予定と同じように
 * 塗った帯にすると、その日に何があるかを読む前に枠が埋まる。出発地まで出さないのも同じ理由で、
 * 「どこへ向かうか」が分かれば予定と結び付けられる。
 */
function TravelChip({
  travel,
  utils,
  continuesBefore,
  onOpen,
}: {
  travel: TravelItem;
  utils: CalendarDateUtils;
  continuesBefore: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="type-label-small flex h-[17px] w-full min-w-0 items-center gap-1 overflow-hidden rounded-xs border border-travel/50 bg-surface-container-lowest px-1 text-left text-[9px] leading-[15px] font-medium sm:h-[18px] sm:text-[10px] sm:leading-4"
      title={`${travel.title}（${utils.formatTime(travel.start)}発）`}
    >
      <TravelMark className="size-2 text-travel" />
      {/* 出発時刻は実際に出発する日にだけ添える。日をまたいだ続きの側に出すと、その日に出発したように読める。 */}
      {!continuesBefore && (
        <span className="hidden shrink-0 opacity-70 sm:inline">{utils.formatTime(travel.start)}</span>
      )}
      <span className="clip-nowrap">{travel.destination}</span>
    </button>
  );
}
