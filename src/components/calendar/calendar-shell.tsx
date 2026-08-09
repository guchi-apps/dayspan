"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useOffline } from "next/offline";
import { Suspense, use, useMemo, useOptimistic, useState, useTransition } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw, Settings } from "lucide-react";

import { BottomNav, HeaderNav } from "@/components/nav/main-nav";
import { OFFLINE_WRITE_MESSAGE, OfflineNotice } from "@/components/offline/offline-notice";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { Button } from "@/components/ui/button";
import { LinearProgress } from "@/components/ui/linear-progress";
import {
  addDays,
  getContinuousMonthWeeks,
  getVisibleDays,
  monthDistance,
  monthsOfWeeks,
  parseDateKey,
  parseMonthKey,
  shiftAnchor,
  shiftMonthKey,
  toDateKey,
  type CalendarView,
} from "@/lib/calendar-range";
import { cn } from "@/lib/utils";
import type { CalendarEventItem, CalendarLoadResult, TaskItem } from "@/types/calendar";

import { CalendarGridSkeleton } from "./calendar-skeleton";
import { dateKeyPlusMinutes, localInputToIso } from "./datetime-fields";
import { EventDetailDialog } from "./event-detail-dialog";
import { EventDialog, toEventDraft, type EventDraft } from "./event-dialog";
import { createCalendarDateUtils, type CalendarDateUtils } from "./item-layout";
import { ContinuousMonthView } from "./continuous-month-view";
import { TaskDetailDialog } from "./task-detail-dialog";
import { TaskDialog, toTaskDraft, type TaskDraft } from "./task-dialog";
import { TimeGridView } from "./time-grid-view";
import { monthsOfRanges, useCalendarChunks, type TouchedRange } from "./use-calendar-chunks";
import type { AllDayDragCommit, DragCommit } from "./use-grid-drag";

const VIEW_LABELS: { view: CalendarView; label: string; desktopOnly?: boolean }[] = [
  { view: "month", label: "月" },
  { view: "day1", label: "1日" },
  { view: "day3", label: "3日" },
  { view: "day7", label: "7日", desktopOnly: true },
];

export function CalendarShell({
  view,
  anchorKey,
  days,
  weeks,
  dataPromise,
  weekStartsOn,
  timeZone,
  autoRefreshSeconds,
}: {
  view: CalendarView;
  anchorKey: string;
  days: string[];
  weeks: string[][];
  dataPromise: Promise<CalendarLoadResult>;
  weekStartsOn: number;
  timeZone: string;
  autoRefreshSeconds: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // オフライン中は書き込みを止める（docs/spec.md §21）。ここで判定した結果を、
  // 追加ボタン・ドラッグ・編集への入口すべてへ配って、送る前に断つ。
  const offline = useOffline();
  useReconnectRefresh();

  // 月のデータを取りにいっているか。取得はSuspense境界の内側で起きるが、
  // 進行の表示はヘッダー直下（境界の外）にあるため、ここまで上げてもらう。
  const [windowLoading, setWindowLoading] = useState(false);
  const utils = useMemo(() => createCalendarDateUtils(timeZone), [timeZone]);

  // 押した直後に見出しが変わるよう、遷移中は指定した期間を先に表示する。
  const [nav, setNav] = useOptimistic({ view, anchorKey });

  // 連続スクロール中の月は、サーバーの応答を待たずに見出しへ反映する。
  const [scrolledMonth, setScrolledMonth] = useState(anchorKey.slice(0, 7));

  // 保持している月の中心。ここを動かすと、前後の月ぶんの並びとデータが張り直される。
  const [monthCenter, setMonthCenter] = useState(anchorKey.slice(0, 7));

  // 月表示の移動はスクロールで行う。同じ月を続けて指しても効くよう、指示に通し番号を付ける。
  const [scrollTarget, setScrollTarget] = useState({ month: anchorKey.slice(0, 7), nonce: 0 });

  // 月表示の週の並びは、サーバーの anchor ではなく保持中の窓から決まる。
  const monthWeeks = useMemo(
    () => getContinuousMonthWeeks(parseMonthKey(monthCenter), weekStartsOn).weeks,
    [monthCenter, weekStartsOn],
  );

  // 画面に出しうる月と、サーバーが描いてよこした月。前者に足りないぶんをAPIから足す。
  const windowMonths = useMemo(() => monthsOfWeeks(monthWeeks), [monthWeeks]);
  const serverMonths = useMemo(() => monthsOfWeeks(weeks), [weeks]);

  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft | null>(null);
  // クリックした直後は表示専用画面を開く。編集アイコンを押したときだけ draft へ切り替える。
  const [viewingEvent, setViewingEvent] = useState<CalendarEventItem | null>(null);
  const [viewingTask, setViewingTask] = useState<TaskItem | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const closeDialogs = () => {
    setEventDraft(null);
    setTaskDraft(null);
    setViewingEvent(null);
    setViewingTask(null);
  };

  /** 月表示以外の取り直し。ページごと描き直すため、表示中の期間ぶんをすべて取り直す。 */
  const refreshAll = () => {
    startTransition(() => router.refresh());
  };

  const [dragError, setDragError] = useState<string | null>(null);

  /**
   * ドラッグで変わった時刻を保存する。失敗しても画面の見た目は元へ戻す（再取得する）ので、
   * 保存できたつもりのまま作業が進まないようにする。
   */
  const commitDrag = async (commit: DragCommit) => {
    setDragError(null);

    // ドラッグ自体もオフラインでは始まらないようにしてあるが、通信が落ちるのは操作の途中でも
    // 起こる。送る直前でもう一度見て、保存できたつもりのまま画面だけ動くことを防ぐ。
    if (offline) {
      setDragError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    const startIso = localInputToIso(dateKeyPlusMinutes(commit.dayKey, commit.startMinutes), timeZone);

    try {
      let response: Response;

      if (commit.target.kind === "event") {
        const event = commit.target.item;
        response = await fetch(`/api/events/${encodeURIComponent(event.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            calendarId: event.calendarId,
            title: event.title,
            allDay: false,
            start: startIso,
            end: localInputToIso(
              dateKeyPlusMinutes(commit.dayKey, commit.endMinutes),
              timeZone,
            ),
          }),
        });
      } else {
        response = await fetch(`/api/tasks/${encodeURIComponent(commit.target.item.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ due: startIso }),
        });
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setDragError(body?.message ?? "変更を保存できませんでした。");
      }
    } catch {
      setDragError("変更を保存できませんでした。");
    } finally {
      startTransition(() => router.refresh());
    }
  };

  /** 終日エリアのドラッグ。動かせるのは日付だけなので、日数分ずらして保存する。 */
  const commitAllDayDrag = async (commit: AllDayDragCommit) => {
    setDragError(null);

    if (offline) {
      setDragError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    try {
      let response: Response;

      if (commit.target.kind === "event") {
        const event = commit.target.item;
        response = await fetch(`/api/events/${encodeURIComponent(event.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            calendarId: event.calendarId,
            title: event.title,
            allDay: true,
            start: shiftDateKey(event.start, commit.deltaDays),
            end: shiftDateKey(event.end, commit.deltaDays),
          }),
        });
      } else {
        response = await fetch(`/api/tasks/${encodeURIComponent(commit.target.item.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ due: commit.dayKey }),
        });
      }

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setDragError(body?.message ?? "変更を保存できませんでした。");
      }
    } catch {
      setDragError("変更を保存できませんでした。");
    } finally {
      startTransition(() => router.refresh());
    }
  };

  const openEvent = (event: CalendarEventItem) => setViewingEvent(event);

  const editEvent = (event: CalendarEventItem) => {
    if (offline) return;
    setViewingEvent(null);
    setEventDraft(toEventDraft(event, timeZone));
  };

  const editTask = (task: TaskItem) => {
    if (offline) return;
    setViewingTask(null);
    setTaskDraft(toTaskDraft(task, timeZone));
  };

  // 月表示ではスクロール位置が、それ以外では選択中の期間が見出しになる。
  const headerLabel =
    nav.view === "month"
      ? formatMonthLabel(scrolledMonth)
      : formatRangeLabel(
          nav.view,
          nav.anchorKey,
          getVisibleDays(nav.view, parseDateKey(nav.anchorKey), weekStartsOn).days,
        );
  const openTask = (task: TaskItem) => setViewingTask(task);

  /** 新規作成の初期値。時間グリッドの空き時間を選んだ場合はその日時から1時間で開く。 */
  const newEventDraft = (dateKey: string, minutes: number | null): EventDraft => {
    if (minutes === null) {
      return { allDay: true, start: dateKey, end: dateKey };
    }
    return {
      allDay: false,
      start: dateKeyPlusMinutes(dateKey, minutes),
      end: dateKeyPlusMinutes(dateKey, Math.min(minutes + 60, 23 * 60 + 30)),
    };
  };

  const navigate = (nextView: CalendarView, nextAnchorKey: string) => {
    startTransition(() => {
      setNav({ view: nextView, anchorKey: nextAnchorKey });
      router.push(`/calendar?view=${nextView}&date=${nextAnchorKey}`);
    });
  };

  /**
   * 月表示の移動。読み込み済みの範囲の中なら、サーバーへ行かずスクロールするだけで済む。
   * 窓の外へ出る場合も、先に並びを張り直してから足りない月だけを取りにいく。
   */
  const goToMonth = (month: string) => {
    setScrolledMonth(month);
    setMonthCenter(month);
    setScrollTarget((prev) => ({ month, nonce: prev.nonce + 1 }));
    syncMonthUrl(month);
  };

  const move = (direction: 1 | -1) => {
    if (nav.view === "month") {
      goToMonth(shiftMonthKey(scrolledMonth, direction));
      return;
    }

    navigate(nav.view, toDateKey(shiftAnchor(nav.view, parseDateKey(nav.anchorKey), direction)));
  };

  /**
   * スワイプでの移動。前へ・次へと違い、期間ではなく日数で動かす。
   * 3日ずつしか動けないと、今日を真ん中に置くような見方に切り替えられないため。
   */
  const moveDays = (deltaDays: number) => {
    navigate(nav.view, toDateKey(addDays(parseDateKey(nav.anchorKey), deltaDays)));
  };

  const goToday = () => {
    if (nav.view === "month") {
      goToMonth(utils.todayKey().slice(0, 7));
      return;
    }

    navigate(nav.view, utils.todayKey());
  };

  /** スクロールで見えている月が変わったとき。 */
  const handleVisibleMonthChange = (month: string) => {
    setScrolledMonth(month);
    syncMonthUrl(month);

    // 窓の端へ近づいたら中心をずらし、先の月を前もって取りにいく。
    // 1ヶ月ごとにずらすと週の並びを組み直す回数が増えるため、2ヶ月離れてから動かす。
    if (Math.abs(monthDistance(monthCenter, month)) >= 2) setMonthCenter(month);
  };

  /**
   * 時間グリッドに並べる日。
   *
   * サーバーが渡してきた期間ではなく、押した直後に更新される nav を起点にする。
   * 前へ・次へやスワイプは、取得の完了を待たずにその場で隣の期間へ切り替わってほしい。
   * 表示形式そのものを変えている最中は、日数が変わるためサーバーの期間に従う。
   */
  const gridDays = useMemo(() => {
    if (view === "month" || nav.view !== view) return days;
    return getVisibleDays(view, parseDateKey(nav.anchorKey), weekStartsOn).days;
  }, [view, nav.view, nav.anchorKey, days, weekStartsOn]);

  // 予定を追加するときの既定の日。月表示は広い範囲を並べているため、先頭の日ではなく今日を使う。
  const defaultDayKey = view === "month" ? utils.todayKey() : gridDays[0];

  // 表示形式を切り替えたときの移動先。月表示はスクロールで移動するため anchorKey が
  // 更新されない（URLだけが replaceState で追従する）。見えている月を起点にする。
  const viewSwitchAnchorKey = nav.view === "month" ? `${scrolledMonth}-01` : anchorKey;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-1 bg-surface-container-low px-1 py-1.5 md:gap-2 md:px-2 md:py-2">
        {/* 狭い画面ではアプリ名を出さない。現在地は下部のナビゲーションバーが示している。 */}
        <div className="hidden items-center gap-1 font-semibold md:flex">
          <CalendarDays className="size-5" />
          <span className="hidden lg:inline">DaySpan</span>
        </div>

        <HeaderNav current="calendar" />

        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-10 md:size-9"
            onClick={() => move(-1)}
            aria-label="前へ"
          >
            <ChevronLeft className="size-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-10 md:size-9"
            onClick={() => move(1)}
            aria-label="次へ"
          >
            <ChevronRight className="size-5" />
          </Button>
        </div>

        {/* どの期間を見ているかは常に読めなければならない。他の操作より優先して幅を与える。 */}
        <h1 className="type-title-medium md:type-title-large min-w-0 flex-1 truncate">
          {headerLabel}
        </h1>

        {/* M3のタップ対象は最低48dp。狭い画面では見た目より当たり判定を優先して高さを取る。 */}
        <Button variant="outline" size="xs" className="h-10 px-3 md:h-8 md:px-4" onClick={goToday}>
          今日
        </Button>

        {/* M3のセグメンテッドボタン。排他的な選択であることを、隣接した枠で示す。 */}
        <div className="flex items-center overflow-hidden rounded-full border border-outline">
          {VIEW_LABELS.map((item) => (
            <Button
              key={item.view}
              variant={nav.view === item.view ? "secondary" : "ghost"}
              size="xs"
              className={cn(
                "type-label-medium h-10 rounded-none px-3 md:type-label-large md:h-8",
                nav.view === item.view && "text-on-secondary-container",
                item.desktopOnly && "hidden md:inline-flex",
              )}
              onClick={() => navigate(item.view, viewSwitchAnchorKey)}
            >
              {item.label}
            </Button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="size-10 md:size-9"
          // オフライン中に押しても、再接続まで終わらない読み込みが始まるだけになる。
          // 通信が戻った時点の取り直しは useReconnectRefresh が行う。
          disabled={pending || offline}
          aria-label="再取得"
          onClick={() => startTransition(() => router.refresh())}
        >
          <RefreshCw className="size-5" />
        </Button>
        <Button variant="ghost" size="icon-sm" asChild aria-label="設定" className="hidden md:inline-flex">
          <Link href="/settings">
            <Settings className="size-4" />
          </Link>
        </Button>
      </header>

      <LinearProgress active={pending || windowLoading} />

      <OfflineNotice />

      {/*
        予定とタスクの到着を待つ必要があるのはグリッドだけ。どの期間を見ているかは
        取得前から決まっているため、ヘッダーは待たせずに描く。
        なお前へ・次へは startTransition の中で遷移するため、ここは骨組みへ戻らず、
        表示中の内容を保ったまま差し替わる（操作のたびに画面が消えることはない）。
      */}
      <Suspense fallback={<CalendarGridSkeleton />}>
        <CalendarBody
          dataPromise={dataPromise}
          view={view}
          days={gridDays}
          weeks={view === "month" ? monthWeeks : weeks}
          weekStartsOn={weekStartsOn}
          utils={utils}
          timeZone={timeZone}
          windowMonths={windowMonths}
          serverMonths={serverMonths}
          scrollTarget={scrollTarget}
          autoRefreshSeconds={autoRefreshSeconds}
          offline={offline}
          dragError={dragError}
          addMenuOpen={addMenuOpen}
          eventDraft={eventDraft}
          taskDraft={taskDraft}
          viewingEvent={viewingEvent}
          viewingTask={viewingTask}
          onVisibleMonthChange={handleVisibleMonthChange}
          onSwipe={moveDays}
          onSelectDay={(dateKey) => navigate("day1", dateKey)}
          onOpenEvent={openEvent}
          onOpenTask={openTask}
          onEditEvent={editEvent}
          onEditTask={editTask}
          onSelectSlot={(dateKey, minutes) => {
            if (offline) return;
            setEventDraft(newEventDraft(dateKey, minutes));
          }}
          onDragCommit={commitDrag}
          onAllDayDragCommit={commitAllDayDrag}
          onToggleAddMenu={() => setAddMenuOpen((prev) => !prev)}
          onAddEvent={() => {
            setAddMenuOpen(false);
            setEventDraft(newEventDraft(defaultDayKey, 9 * 60));
          }}
          onAddTask={() => {
            setAddMenuOpen(false);
            setTaskDraft({ dueMode: "datetime", due: dateKeyPlusMinutes(defaultDayKey, 18 * 60) });
          }}
          onCloseDialogs={closeDialogs}
          onRefreshAll={refreshAll}
          onLoadingChange={setWindowLoading}
        />
      </Suspense>

      <BottomNav current="calendar" />
    </div>
  );
}

/**
 * 見ている月をURLへ反映する。
 * replaceState はサーバーへ行かないため、これ自体では再取得を起こさない
 * （リロードや保存後の再取得のときに、見ていた月が起点になる）。
 */
function syncMonthUrl(month: string) {
  window.history.replaceState(null, "", `/calendar?view=month&date=${month}-01`);
}

/** 取得した予定とタスクに依存する部分。ここだけが読み込みを待つ。 */
function CalendarBody({
  dataPromise,
  view,
  days,
  weeks,
  weekStartsOn,
  utils,
  timeZone,
  windowMonths,
  serverMonths,
  scrollTarget,
  autoRefreshSeconds,
  offline,
  dragError,
  addMenuOpen,
  eventDraft,
  taskDraft,
  viewingEvent,
  viewingTask,
  onVisibleMonthChange,
  onSwipe,
  onSelectDay,
  onOpenEvent,
  onOpenTask,
  onEditEvent,
  onEditTask,
  onSelectSlot,
  onDragCommit,
  onAllDayDragCommit,
  onToggleAddMenu,
  onAddEvent,
  onAddTask,
  onCloseDialogs,
  onRefreshAll,
  onLoadingChange,
}: {
  dataPromise: Promise<CalendarLoadResult>;
  view: CalendarView;
  days: string[];
  weeks: string[][];
  weekStartsOn: number;
  utils: CalendarDateUtils;
  timeZone: string;
  windowMonths: string[];
  serverMonths: string[];
  scrollTarget: { month: string; nonce: number };
  autoRefreshSeconds: number;
  offline: boolean;
  dragError: string | null;
  addMenuOpen: boolean;
  eventDraft: EventDraft | null;
  taskDraft: TaskDraft | null;
  viewingEvent: CalendarEventItem | null;
  viewingTask: TaskItem | null;
  onVisibleMonthChange: (monthKey: string) => void;
  onSwipe: (deltaDays: number) => void;
  onSelectDay: (dateKey: string) => void;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onEditEvent: (event: CalendarEventItem) => void;
  onEditTask: (task: TaskItem) => void;
  onSelectSlot: (dateKey: string, minutes: number | null) => void;
  onDragCommit: (commit: DragCommit) => void;
  onAllDayDragCommit: (commit: AllDayDragCommit) => void;
  onToggleAddMenu: () => void;
  onAddEvent: () => void;
  onAddTask: () => void;
  onCloseDialogs: () => void;
  onRefreshAll: () => void;
  onLoadingChange: (loading: boolean) => void;
}) {
  const initial = use(dataPromise);

  // 月表示だけは、前後の月ぶんをここで保持して足りない月だけ取りにいく。
  const data = useCalendarChunks({
    enabled: view === "month",
    windowMonths,
    initial,
    serverMonths,
    autoRefreshSeconds,
    onLoadingChange,
  });

  /**
   * 保存・削除のあとの取り直し。
   *
   * 月表示は変わった月だけを取り直す。ページごと描き直すと、表示中の月すべてを
   * 外部APIから取り直すことになり、保存のたびにその待ち時間が乗る。
   */
  const handleSaved = (touched: TouchedRange[] | null) => {
    onCloseDialogs();

    if (view !== "month") {
      onRefreshAll();
      return;
    }

    data.invalidate(touched === null ? null : monthsOfRanges(touched));
  };

  /** 表示画面のままの完了切り替え。編集フォームを経由しないため保存とは別経路で送る。 */
  const handleToggleTaskDone = async (task: TaskItem, done: boolean) => {
    if (offline) throw new Error(OFFLINE_WRITE_MESSAGE);

    const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // 繰り返しタスクは完了時に次回分が作られるため、通常の更新とは別の経路で送る。
      body: JSON.stringify({ done, completeAction: true }),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? "更新できませんでした。");
    }

    if (view !== "month") {
      onRefreshAll();
      return;
    }

    data.invalidate(task.due ? monthsOfRanges([{ start: task.due, end: task.due }]) : null);
  };

  return (
    <>
      {(data.errors.length > 0 || data.loadError || dragError) && (
        <div className="flex flex-col gap-1 bg-error-container/70 text-on-error-container px-3 py-2 text-xs">
          {data.errors.map((error) => (
            <span key={`${error.source}-${error.reason}`}>{error.reason}</span>
          ))}
          {data.loadError && <span>{data.loadError}</span>}
          {dragError && <span>{dragError}</span>}
        </div>
      )}

      {view === "month" ? (
        <ContinuousMonthView
          weeks={weeks}
          events={data.events}
          tasks={data.tasks}
          weekStartsOn={weekStartsOn}
          utils={utils}
          scrollTarget={scrollTarget}
          pendingMonths={data.pendingMonths}
          onVisibleMonthChange={onVisibleMonthChange}
          onSelectDay={onSelectDay}
          onOpenEvent={onOpenEvent}
          onOpenTask={onOpenTask}
        />
      ) : (
        <TimeGridView
          days={days}
          events={data.events}
          tasks={data.tasks}
          utils={utils}
          onOpenEvent={onOpenEvent}
          onOpenTask={onOpenTask}
          onSelectSlot={onSelectSlot}
          onDragCommit={onDragCommit}
          onAllDayDragCommit={onAllDayDragCommit}
          onSwipe={onSwipe}
          readOnly={offline}
        />
      )}

      <AddButton
        open={addMenuOpen}
        canAddEvent={!offline && data.calendars.length > 0}
        canAddTask={!offline && data.notionReady}
        onToggle={onToggleAddMenu}
        onAddEvent={onAddEvent}
        onAddTask={onAddTask}
      />

      {eventDraft && (
        <EventDialog
          draft={eventDraft}
          calendars={data.calendars}
          timeZone={timeZone}
          onClose={onCloseDialogs}
          onSaved={handleSaved}
        />
      )}

      {taskDraft && (
        <TaskDialog
          draft={taskDraft}
          timeZone={timeZone}
          onClose={onCloseDialogs}
          onSaved={handleSaved}
        />
      )}

      {viewingEvent && (
        <EventDetailDialog
          event={viewingEvent}
          timeZone={timeZone}
          readOnly={offline}
          onClose={onCloseDialogs}
          onEdit={() => onEditEvent(viewingEvent)}
        />
      )}

      {viewingTask && (
        <TaskDetailDialog
          task={viewingTask}
          timeZone={timeZone}
          readOnly={offline}
          onClose={onCloseDialogs}
          onEdit={() => onEditTask(viewingTask)}
          onToggleDone={handleToggleTaskDone}
        />
      )}
    </>
  );
}

/** YYYY-MM-DD を日数分ずらす。UTC正午で扱い、タイムゾーンによる日付ずれを避ける。 */
function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 画面右下の「＋」。押すと予定とタスクのどちらを追加するか選ぶ（docs/spec.md §15）。 */
function AddButton({
  open,
  canAddEvent,
  canAddTask,
  onToggle,
  onAddEvent,
  onAddTask,
}: {
  open: boolean;
  canAddEvent: boolean;
  canAddTask: boolean;
  onToggle: () => void;
  onAddEvent: () => void;
  onAddTask: () => void;
}) {
  if (!canAddEvent && !canAddTask) return null;

  return (
    <div className="fixed right-4 bottom-[calc(6rem_+_env(safe-area-inset-bottom))] z-30 flex flex-col items-end gap-2 md:bottom-6">
      {open && (
        <div className="flex flex-col gap-2">
          {canAddEvent && (
            <Button
              size="sm"
              variant="secondary"
              className="elevation-2 rounded-lg"
              onClick={onAddEvent}
            >
              予定を追加
            </Button>
          )}
          {canAddTask && (
            <Button
              size="sm"
              variant="secondary"
              className="elevation-2 rounded-lg"
              onClick={onAddTask}
            >
              タスクを追加
            </Button>
          )}
        </div>
      )}

      {/* M3のFAB。角は完全な丸ではなく大きめの角丸で、面として置かれていることを示す。 */}
      <Button
        size="icon"
        aria-expanded={open}
        aria-label="追加"
        className="elevation-3 size-14 rounded-lg bg-primary-container text-on-primary-container hover:brightness-95"
        onClick={onToggle}
      >
        <Plus className={cn("size-6 transition-transform", open && "rotate-45")} />
      </Button>
    </div>
  );
}

function formatMonthLabel(monthKey: string): string {
  return `${monthKey.slice(0, 4)}年${Number(monthKey.slice(5, 7))}月`;
}

function formatRangeLabel(view: CalendarView, anchorKey: string, days: string[]): string {
  if (view === "month") {
    return `${anchorKey.slice(0, 4)}年${Number(anchorKey.slice(5, 7))}月`;
  }

  const first = days[0];
  const last = days[days.length - 1];

  if (first === last) {
    return `${first.slice(0, 4)}年${Number(first.slice(5, 7))}月${Number(first.slice(8, 10))}日`;
  }

  return `${first.slice(0, 4)}年${Number(first.slice(5, 7))}月${Number(first.slice(8, 10))}日 – ${Number(last.slice(5, 7))}月${Number(last.slice(8, 10))}日`;
}
