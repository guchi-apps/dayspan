"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useOffline } from "next/offline";
import { Suspense, use, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw, Settings } from "lucide-react";

import { BottomNav, HeaderNav } from "@/components/nav/main-nav";
import { OFFLINE_WRITE_MESSAGE, OfflineNotice } from "@/components/offline/offline-notice";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { Button } from "@/components/ui/button";
import { LinearProgress } from "@/components/ui/linear-progress";
import {
  addDays,
  getContinuousMonthWeeks,
  getContinuousMonthSpan,
  getVisibleDays,
  monthDistance,
  monthsOfWeeks,
  parseDateKey,
  parseMonthKey,
  shiftAnchor,
  shiftMonthKey,
  toDateKey,
  VIRTUAL_MONTHS_AROUND,
  type CalendarView,
} from "@/lib/calendar-range";
import { cn } from "@/lib/utils";
import type { PlaceCatalog } from "@/services/notion/places";
import type { TagCatalog } from "@/services/notion/tag-options";
import type { ActivityPresetItem, RunningActivityItem } from "@/types/activity";
import type {
  CalendarEventItem,
  CalendarLoadResult,
  ReminderItem,
  TaskItem,
} from "@/types/calendar";

import { ActivityButton } from "./activity-button";
import { ActivitySheet } from "./activity-sheet";
import { CalendarGridSkeleton } from "./calendar-skeleton";
import { dateKeyPlusMinutes, localInputToIso } from "./datetime-fields";
import { EventDetailDialog } from "./event-detail-dialog";
import { duplicateEventDraft, toEventDraft, type EventDraft } from "./event-form";
import { ItemDialog, type ItemDrafts, type ItemKind } from "./item-dialog";
import { createCalendarDateUtils, type CalendarDateUtils } from "./item-layout";
import { ContinuousMonthView } from "./continuous-month-view";
import { QuickEventSheet, toQuickEventDraft, type QuickEventDraft } from "./quick-event-sheet";
import { ReminderDetailDialog } from "./reminder-detail-dialog";
import { toReminderDraft } from "./reminder-form";
import { TaskDetailDialog } from "./task-detail-dialog";
import { toTaskDraft } from "./task-form";
import { TimeGridView, weekdayLabel, weekdayTone } from "./time-grid-view";
import {
  monthsOfRanges,
  taskRanges,
  useCalendarChunks,
  type TouchedRange,
} from "./use-calendar-chunks";
import type { AllDayDragCommit, DragCommit } from "./use-grid-drag";

// 日付だけが決まっている追加（右下の「＋」・月表示の長押し）で使う開始時刻。
const DEFAULT_START_MINUTES = 9 * 60;

// タスクの期限は、その日のうちに片付ける想定の時刻から始める（予定の既定より遅い）。
const DEFAULT_TASK_DUE_MINUTES = 18 * 60;

// 期間の短い順に並べる。同じ並びの中で右へ行くほど広い範囲を見ることになり、
// 「今いる形式より広く／狭く見たい」がどちら向きに押せばよいか迷わずに済む。
const VIEW_LABELS: { view: CalendarView; label: string; desktopOnly?: boolean }[] = [
  { view: "day1", label: "1日" },
  { view: "day3", label: "3日" },
  { view: "day7", label: "週", desktopOnly: true },
  { view: "month", label: "月" },
];

export function CalendarShell({
  view,
  anchorKey,
  days,
  weeks,
  dataPromise,
  tagCatalogPromise,
  placeCatalogPromise,
  activityPresets,
  initialRunningActivity,
  weekStartsOn,
  timeZone,
  autoRefreshSeconds,
}: {
  view: CalendarView;
  anchorKey: string;
  days: string[];
  weeks: string[][];
  dataPromise: Promise<CalendarLoadResult>;
  /**
   * 登録済みのタグ・種類。予定・タスクの取得とは別に解決させる。
   * 月をまたぐたびに取り直す必要は無く、Notionへの往復をそのぶん増やさずに済む。
   */
  tagCatalogPromise: Promise<TagCatalog>;
  /** 登録済みの場所。タグ・種類と同じく、月をまたいでも変わらないため別に解決させる。 */
  placeCatalogPromise: Promise<PlaceCatalog>;
  /** 活動記録の選択肢。DaySpanのDBにあり、外部APIを待たないためそのまま渡す。 */
  activityPresets: ActivityPresetItem[];
  /** 記録中の活動。開始・停止のたびに画面側で持ち替える。 */
  initialRunningActivity: RunningActivityItem | null;
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

  // 画面中央にある週の先頭日。月表示→日表示へ切り替えるとき、この週を起点にする
  // （1日目固定だと、月の途中の週を見ていてもその月の1日目基準のタブへ飛んでしまうため。
  // 上端の週だと、半分だけ見えている週を起点に選んでしまうこともあるため中央を採る）。
  // 読むのは表示形式を切り替える操作の中だけなので、状態にせず ref で持つ。
  // 状態にすると、スクロールで週が変わるたびにカレンダー全体が描き直される。
  const centerWeekRef = useRef(anchorKey);

  // 保持している月の中心。ここを動かすと、前後の月ぶんの並びとデータが張り直される。
  const [monthCenter, setMonthCenter] = useState(anchorKey.slice(0, 7));

  // 月表示の移動はスクロールで行う。同じ月を続けて指しても効くよう、指示に通し番号を付ける。
  // day は特定の日を含む週へ位置合わせしたいときだけ指定する（今日・日表示からの切り替え）。
  // 前へ・次へは行き先の日が決まらないため、月単位のまま指定しない。
  const [scrollTarget, setScrollTarget] = useState<{ month: string; day?: string; nonce: number }>({
    month: anchorKey.slice(0, 7),
    nonce: 0,
  });

  // 月表示の週の並びは、サーバーの anchor ではなく保持中の窓から決まる。
  const monthWeeks = useMemo(
    () => getContinuousMonthWeeks(parseMonthKey(monthCenter), weekStartsOn).weeks,
    [monthCenter, weekStartsOn],
  );

  /*
   * スクロールできる範囲。保持している窓よりずっと広く取り、窓の外側は日付を並べない余白にする。
   *
   * 窓を張り直すたびに並びの長さが変わると、その上にあった週の位置も動き、見ていた場所へ
   * scrollTop を書き戻さなければならない。書き戻しは指でなぞっている最中には効かず、
   * 効かないまま週だけが増えると数ヶ月ぶん飛ぶ。余白で長さを固定しておけば、窓の張り直しは
   * 位置に影響しないため、スクロールの最中でも張り直せる（＝止まらずに読み込みが続く）。
   *
   * 起点を動かすのは位置合わせの指示があったときだけ。そのときは絶対位置で合わせ直す。
   */
  const virtual = useMemo(
    () =>
      getContinuousMonthSpan(
        parseMonthKey(scrollTarget.month),
        weekStartsOn,
        VIRTUAL_MONTHS_AROUND,
      ),
    [scrollTarget.month, weekStartsOn],
  );

  // 画面に出しうる月と、サーバーが描いてよこした月。前者に足りないぶんをAPIから足す。
  const windowMonths = useMemo(() => monthsOfWeeks(monthWeeks), [monthWeeks]);
  const serverMonths = useMemo(() => monthsOfWeeks(weeks), [weeks]);

  // 予定・タスク・日付リマインドの入力。追加では作れる種類ぶんを渡し、
  // どれを作るかを開いてから選べるようにする（docs/spec.md §15）。
  const [itemDialog, setItemDialog] = useState<{
    initialKind: ItemKind;
    drafts: ItemDrafts;
  } | null>(null);
  // 空いているところを押したときの簡易入力。詳細な項目は「詳細」から入力画面へ引き継ぐ。
  const [quickDraft, setQuickDraft] = useState<QuickEventDraft | null>(null);
  // クリックした直後は表示専用画面を開く。編集アイコンを押したときだけ draft へ切り替える。
  const [viewingEvent, setViewingEvent] = useState<CalendarEventItem | null>(null);
  const [viewingTask, setViewingTask] = useState<TaskItem | null>(null);
  const [viewingReminder, setViewingReminder] = useState<ReminderItem | null>(null);

  // いま記録している活動と、その開始・停止・切り替えを行う画面（docs/spec.md §27）。
  const [activityOpen, setActivityOpen] = useState(false);
  const [running, setRunning] = useState(initialRunningActivity);

  // 開始・停止は画面側で先に反映するが、正はサーバーにある（別の端末で止めることもある）。
  // 取り直しでサーバーの値が変わったら、そちらへ戻す。
  const serverRunningKey = runningActivityKey(initialRunningActivity);
  const [knownRunningKey, setKnownRunningKey] = useState(serverRunningKey);
  if (knownRunningKey !== serverRunningKey) {
    setKnownRunningKey(serverRunningKey);
    setRunning(initialRunningActivity);
  }

  const closeDialogs = () => {
    setItemDialog(null);
    setQuickDraft(null);
    setViewingEvent(null);
    setViewingTask(null);
    setViewingReminder(null);
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
        // 掴んだのが期限の枠か予定日の枠かで、書き換える日付が違う。
        response = await fetch(`/api/tasks/${encodeURIComponent(commit.target.item.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [commit.target.field]: startIso }),
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
          body: JSON.stringify({ [commit.target.field]: commit.dayKey }),
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
    setItemDialog({ initialKind: "event", drafts: { event: toEventDraft(event, timeZone) } });
  };

  const duplicateEvent = (event: CalendarEventItem) => {
    if (offline) return;
    setViewingEvent(null);
    setItemDialog({
      initialKind: "event",
      drafts: { event: duplicateEventDraft(event, timeZone) },
    });
  };

  const editTask = (task: TaskItem) => {
    if (offline) return;
    setViewingTask(null);
    setItemDialog({ initialKind: "task", drafts: { task: toTaskDraft(task, timeZone) } });
  };

  const editReminder = (reminder: ReminderItem) => {
    if (offline) return;
    setViewingReminder(null);
    setItemDialog({
      initialKind: "reminder",
      drafts: { reminder: toReminderDraft(reminder, timeZone) },
    });
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
  const openReminder = (reminder: ReminderItem) => setViewingReminder(reminder);

  /** 新規作成の初期値。指定の日時から1時間ぶんで開く。 */
  const newEventDraft = (dateKey: string, minutes: number): EventDraft => ({
    allDay: false,
    start: dateKeyPlusMinutes(dateKey, minutes),
    end: dateKeyPlusMinutes(dateKey, Math.min(minutes + 60, 23 * 60 + 30)),
  });

  /** 簡易入力から通常の入力画面へ移る。入力済みの値はそのまま引き継ぐ。 */
  const openEventForm = (draft: EventDraft) => {
    setQuickDraft(null);
    setItemDialog({ initialKind: "event", drafts: { event: draft } });
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
  const goToMonth = (month: string, day?: string) => {
    setScrolledMonth(month);
    setMonthCenter(month);
    setScrollTarget((prev) => ({ month, day, nonce: prev.nonce + 1 }));
    syncMonthUrl(month);
  };

  /**
   * 日表示から月表示へ切り替えるとき。その日を含む週へ位置合わせしてから遷移する。
   * 何もしないと、以前に月表示を見ていたときの位置（またはマウント時点の初期値）へ
   * スクロールが戻ってしまう。
   */
  const enterMonthView = (dateKey: string) => {
    const month = dateKey.slice(0, 7);
    setScrolledMonth(month);
    setMonthCenter(month);
    setScrollTarget((prev) => ({ month, day: dateKey, nonce: prev.nonce + 1 }));
    navigate("month", dateKey);
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
      // 月の先頭週ではなく今日を含む週へ合わせる。月の先頭週に合わせると、今日が月の
      // どこにあるかで今日の週が何行目に来るかが変わり、日表示からの切り替え
      // （enterMonthView）とも位置がずれるため。
      const todayKey = utils.todayKey();
      goToMonth(todayKey.slice(0, 7), todayKey);
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
    // 張り直しても各週の位置は動かないため、スクロールの最中でも行ってよい。
    if (Math.abs(monthDistance(monthCenter, month)) >= 2) setMonthCenter(month);
  };

  /** スクロールで画面中央に来た週が変わったとき。 */
  const handleVisibleWeekChange = (weekKey: string) => {
    centerWeekRef.current = weekKey;
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

  /**
   * 右下の「＋」からの追加。作れる種類ぶんのひな型をまとめて渡し、
   * 画面上で切り替えられるようにする。日付はどれも同じ日から始める。
   */
  const openAdd = (available: Record<ItemKind, boolean>) => {
    const drafts: ItemDrafts = {};
    if (available.event) drafts.event = newEventDraft(defaultDayKey, DEFAULT_START_MINUTES);
    if (available.task) {
      drafts.task = {
        dueMode: "datetime",
        due: dateKeyPlusMinutes(defaultDayKey, DEFAULT_TASK_DUE_MINUTES),
      };
    }
    if (available.reminder) drafts.reminder = { dateMode: "date", date: defaultDayKey };

    // 「＋」は予定を足す操作として使われることが多い。作れるなら予定から開く。
    const initialKind: ItemKind = available.event ? "event" : available.task ? "task" : "reminder";
    setItemDialog({ initialKind, drafts });
  };

  // 表示形式を切り替えたときの移動先。月表示はスクロールで移動するため anchorKey が
  // 更新されない（URLだけが replaceState で追従する）。見えている週を起点にする。
  const viewSwitchAnchorKey = () => (nav.view === "month" ? centerWeekRef.current : anchorKey);

  /**
   * 月表示から3日・1日表示へ切り替えるときの日。中央の週の先頭日をそのまま使うと、
   * 3日表示の初日・1日表示の日が週の先頭の曜日（例: 日曜）に固定されてしまう。
   * 今日と同じ曜日の日を中央の週から選び、切り替えても見ている曜日の感覚がずれないようにする。
   */
  const viewSwitchDayAnchorKey = () => {
    const weekStart = parseDateKey(centerWeekRef.current);
    const offset = (parseDateKey(utils.todayKey()).getUTCDay() - weekStartsOn + 7) % 7;
    return toDateKey(addDays(weekStart, offset));
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-1 bg-surface-container-low px-1 py-1.5 md:gap-2 md:px-2 md:py-2">
        {/*
          アイコンは狭い画面でも出す。他の画面（タスク・日付リマインド）は左上にアイコンがあり、
          カレンダーだけ日付から始まると、同じアプリの中で先頭の位置が揃わないため。
          アプリ名は幅の広いときだけ。狭い画面では年月の表示幅を優先する。
          カレンダーアイコンをクリックすると今日の日付に飛ぶ。
        */}
        <Button
          variant="ghost"
          onClick={goToday}
          className="shrink-0 gap-1 font-semibold px-2 py-1.5"
          aria-label="今日に飛ぶ"
        >
          <CalendarDays className="size-5" />
          <span className="hidden lg:inline">DaySpan</span>
        </Button>

        <HeaderNav current="calendar" />

        {/* スマートフォンはスワイプで移動できるため、年月の表示幅を優先する。 */}
        <div className="hidden items-center md:flex">
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

        {/*
          どの期間を見ているかは常に読めなければならない。他の操作より優先して幅を与える。
          年は控えめに、月日は大きく置く。年号まで同じ大きさで並べると、いま見ている
          月日がその中に埋もれて、目を留めないと読み取れないため。
        */}
        <h1 className="flex min-w-0 flex-1 items-baseline gap-1 md:gap-1.5">
          {headerLabel.year && (
            <span className="type-label-medium md:type-title-small shrink-0 text-on-surface-variant">
              {headerLabel.year}
            </span>
          )}
          <span className="type-title-medium md:type-headline-small truncate">
            {headerLabel.main}
          </span>
          {headerLabel.weekday && (
            <span
              className={cn(
                "type-label-medium md:type-title-small shrink-0",
                headerLabel.weekday.tone ?? "text-on-surface-variant",
              )}
            >
              ({headerLabel.weekday.label})
            </span>
          )}
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
              onClick={() => {
                if (item.view === "month") {
                  // 月表示のまま押しても、以前の位置合わせを乱さないよう何もしない。
                  if (nav.view !== "month") enterMonthView(viewSwitchAnchorKey());
                  return;
                }

                if (nav.view === "month" && item.view !== "day7") {
                  navigate(item.view, viewSwitchDayAnchorKey());
                  return;
                }

                navigate(item.view, viewSwitchAnchorKey());
              }}
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
          tagCatalogPromise={tagCatalogPromise}
          placeCatalogPromise={placeCatalogPromise}
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
          itemDialog={itemDialog}
          quickDraft={quickDraft}
          viewingEvent={viewingEvent}
          viewingTask={viewingTask}
          viewingReminder={viewingReminder}
          virtual={virtual}
          onVisibleMonthChange={handleVisibleMonthChange}
          onVisibleWeekChange={handleVisibleWeekChange}
          onSwipe={moveDays}
          onSelectDay={(dateKey) => navigate("day1", dateKey)}
          onOpenEvent={openEvent}
          onOpenTask={openTask}
          onOpenReminder={openReminder}
          onEditEvent={editEvent}
          onDuplicateEvent={duplicateEvent}
          onEditTask={editTask}
          onEditReminder={editReminder}
          onSelectSlot={(dateKey, minutes) => {
            if (offline) return;
            setQuickDraft(toQuickEventDraft(dateKey, minutes));
          }}
          onQuickAddOnDay={(dateKey) => {
            if (offline) return;
            setQuickDraft(toQuickEventDraft(dateKey, DEFAULT_START_MINUTES));
          }}
          onOpenEventForm={openEventForm}
          onDragCommit={commitDrag}
          onAllDayDragCommit={commitAllDayDrag}
          onAdd={openAdd}
          onCloseDialogs={closeDialogs}
          onRefreshAll={refreshAll}
          onLoadingChange={setWindowLoading}
          activityPresets={activityPresets}
          runningActivity={running}
          activityOpen={activityOpen}
          onActivityOpenChange={setActivityOpen}
          onRunningActivityChange={setRunning}
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
  tagCatalogPromise,
  placeCatalogPromise,
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
  itemDialog,
  quickDraft,
  viewingEvent,
  viewingTask,
  viewingReminder,
  virtual,
  onVisibleMonthChange,
  onVisibleWeekChange,
  onSwipe,
  onSelectDay,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
  onEditEvent,
  onDuplicateEvent,
  onEditTask,
  onEditReminder,
  onSelectSlot,
  onQuickAddOnDay,
  onOpenEventForm,
  onDragCommit,
  onAllDayDragCommit,
  onAdd,
  onCloseDialogs,
  onRefreshAll,
  onLoadingChange,
  activityPresets,
  runningActivity,
  activityOpen,
  onActivityOpenChange,
  onRunningActivityChange,
}: {
  dataPromise: Promise<CalendarLoadResult>;
  tagCatalogPromise: Promise<TagCatalog>;
  placeCatalogPromise: Promise<PlaceCatalog>;
  view: CalendarView;
  days: string[];
  weeks: string[][];
  weekStartsOn: number;
  utils: CalendarDateUtils;
  timeZone: string;
  windowMonths: string[];
  serverMonths: string[];
  scrollTarget: { month: string; day?: string; nonce: number };
  autoRefreshSeconds: number;
  offline: boolean;
  dragError: string | null;
  itemDialog: { initialKind: ItemKind; drafts: ItemDrafts } | null;
  quickDraft: QuickEventDraft | null;
  viewingEvent: CalendarEventItem | null;
  viewingTask: TaskItem | null;
  viewingReminder: ReminderItem | null;
  virtual: { firstWeekKey: string; weekCount: number };
  onVisibleMonthChange: (monthKey: string) => void;
  onVisibleWeekChange: (weekKey: string) => void;
  onSwipe: (deltaDays: number) => void;
  onSelectDay: (dateKey: string) => void;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onOpenReminder: (reminder: ReminderItem) => void;
  onEditEvent: (event: CalendarEventItem) => void;
  onDuplicateEvent: (event: CalendarEventItem) => void;
  onEditTask: (task: TaskItem) => void;
  onEditReminder: (reminder: ReminderItem) => void;
  onSelectSlot: (dateKey: string, minutes: number) => void;
  onQuickAddOnDay: (dateKey: string) => void;
  onOpenEventForm: (draft: EventDraft) => void;
  onDragCommit: (commit: DragCommit) => void;
  onAllDayDragCommit: (commit: AllDayDragCommit) => void;
  /** 右下の「＋」。作れる種類を渡し、ひな型は呼び出し側で作る。 */
  onAdd: (available: Record<ItemKind, boolean>) => void;
  onCloseDialogs: () => void;
  onRefreshAll: () => void;
  onLoadingChange: (loading: boolean) => void;
  activityPresets: ActivityPresetItem[];
  runningActivity: RunningActivityItem | null;
  activityOpen: boolean;
  onActivityOpenChange: (open: boolean) => void;
  onRunningActivityChange: (running: RunningActivityItem | null) => void;
}) {
  const initial = use(dataPromise);
  const tagCatalog = use(tagCatalogPromise);
  const placeCatalog = use(placeCatalogPromise);

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

    // 完了にすると繰り返しの次回分が別の日に作られることもあるため、
    // 期限と予定日の両方がかかる月を取り直す。
    data.invalidate(monthsOfRanges(taskRanges(task)));
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
          reminders={data.reminders}
          weekStartsOn={weekStartsOn}
          utils={utils}
          scrollTarget={scrollTarget}
          pendingMonths={data.pendingMonths}
          virtual={virtual}
          onVisibleMonthChange={onVisibleMonthChange}
          onVisibleWeekChange={onVisibleWeekChange}
          onSelectDay={onSelectDay}
          onQuickAdd={onQuickAddOnDay}
          onOpenEvent={onOpenEvent}
          onOpenTask={onOpenTask}
          onOpenReminder={onOpenReminder}
        />
      ) : (
        <TimeGridView
          days={days}
          events={data.events}
          tasks={data.tasks}
          reminders={data.reminders}
          runningActivity={runningActivity}
          utils={utils}
          onOpenEvent={onOpenEvent}
          onOpenTask={onOpenTask}
          onOpenReminder={onOpenReminder}
          onOpenActivity={() => onActivityOpenChange(true)}
          onSelectSlot={onSelectSlot}
          onDragCommit={onDragCommit}
          onAllDayDragCommit={onAllDayDragCommit}
          onSwipe={onSwipe}
          readOnly={offline}
        />
      )}

      {/* 記録先はGoogle Calendarなので、書き込めるカレンダーが無ければ置いても押せない。 */}
      {data.calendars.length > 0 && (
        <ActivityButton
          running={runningActivity}
          disabled={offline}
          onOpen={() => onActivityOpenChange(true)}
        />
      )}

      <AddButton
        available={{
          event: !offline && data.calendars.length > 0,
          task: !offline && data.notionReady,
          reminder: !offline && data.reminderReady,
        }}
        onAdd={onAdd}
      />

      {itemDialog && (
        <ItemDialog
          initialKind={itemDialog.initialKind}
          drafts={itemDialog.drafts}
          calendars={data.calendars}
          tagCatalog={tagCatalog}
          placeCatalog={placeCatalog}
          timeZone={timeZone}
          weekStartsOn={weekStartsOn}
          onClose={onCloseDialogs}
          onSaved={handleSaved}
        />
      )}

      {/* 保存先が1つも無いと入力しても保存できない。押しても何も起きない画面は出さない。 */}
      {quickDraft && data.calendars.length > 0 && (
        <QuickEventSheet
          draft={quickDraft}
          calendars={data.calendars}
          timeZone={timeZone}
          onClose={onCloseDialogs}
          onSaved={handleSaved}
          onOpenDetail={onOpenEventForm}
        />
      )}

      {viewingEvent && (
        <EventDetailDialog
          event={viewingEvent}
          timeZone={timeZone}
          readOnly={offline}
          onClose={onCloseDialogs}
          onEdit={() => onEditEvent(viewingEvent)}
          onDuplicate={() => onDuplicateEvent(viewingEvent)}
          onDeleted={handleSaved}
        />
      )}

      {viewingTask && (
        <TaskDetailDialog
          task={viewingTask}
          tagOptions={tagCatalog.task ?? []}
          timeZone={timeZone}
          readOnly={offline}
          onClose={onCloseDialogs}
          onEdit={() => onEditTask(viewingTask)}
          onDeleted={handleSaved}
          onToggleDone={handleToggleTaskDone}
        />
      )}

      {activityOpen && (
        <ActivitySheet
          presets={activityPresets}
          running={runningActivity}
          timeZone={timeZone}
          onClose={() => onActivityOpenChange(false)}
          onRunningChange={onRunningActivityChange}
          onSaved={(touched) => {
            onActivityOpenChange(false);
            // 止めた時点でGoogle側に予定ができている。その期間だけ取り直す。
            handleSaved(touched);
          }}
        />
      )}

      {viewingReminder && (
        <ReminderDetailDialog
          reminder={viewingReminder}
          categoryOptions={tagCatalog.reminder ?? []}
          timeZone={timeZone}
          readOnly={offline}
          onClose={onCloseDialogs}
          onEdit={() => onEditReminder(viewingReminder)}
          onDeleted={handleSaved}
        />
      )}
    </>
  );
}

/**
 * 記録中の活動が同じものかを比べるための文字列。
 * サーバーから来る値は取り直しのたびに別のオブジェクトになるため、参照では比べられない。
 */
function runningActivityKey(running: RunningActivityItem | null): string {
  return running ? `${running.title} ${running.startedAt}` : "";
}

/** YYYY-MM-DD を日数分ずらす。UTC正午で扱い、タイムゾーンによる日付ずれを避ける。 */
function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * 画面右下の「＋」。押すと入力画面が開き、そこで予定・タスク・日付リマインドを
 * 切り替える（docs/spec.md §15）。何を作るかは開いてからでも選べるため、
 * ここでは種類を選ばせない。
 */
function AddButton({
  available,
  onAdd,
}: {
  available: Record<ItemKind, boolean>;
  onAdd: (available: Record<ItemKind, boolean>) => void;
}) {
  if (!available.event && !available.task && !available.reminder) return null;

  return (
    <div className="fixed right-4 bottom-[calc(6rem_+_env(safe-area-inset-bottom))] z-30 md:bottom-6">
      {/* M3のFAB。角は完全な丸ではなく大きめの角丸で、面として置かれていることを示す。 */}
      <Button
        size="icon"
        aria-label="追加"
        className="elevation-3 size-14 rounded-lg bg-primary-container text-on-primary-container hover:brightness-95"
        onClick={() => onAdd(available)}
      >
        <Plus className="size-6" />
      </Button>
    </div>
  );
}

/**
 * ヘッダーに出す年月日。1つの文字列ではなく年・月日・曜日に分けて返す。
 * 同じ大きさで並べると、探している月日が年号に埋もれて一目で拾えないため、
 * 画面側で字の大きさと濃さを変えられる形で渡す。
 */
type HeaderLabel = {
  /** 「2026年」。範囲が年をまたぐときは先頭の年だけを出し、またいだ先は main に入れる。
   *  1日・3日表示は幅が足りず見切れるため空文字にする */
  year: string;
  /** 「8月」「8月12日」「8月10日 – 16日」 */
  main: string;
  /** 1日表示のときだけ。曜日はグリッドと同じ配色にする */
  weekday: { label: string; tone: string | null } | null;
};

function formatMonthLabel(monthKey: string): HeaderLabel {
  return {
    year: `${monthKey.slice(0, 4)}年`,
    main: `${Number(monthKey.slice(5, 7))}月`,
    weekday: null,
  };
}

function formatRangeLabel(view: CalendarView, anchorKey: string, days: string[]): HeaderLabel {
  if (view === "month") {
    return formatMonthLabel(anchorKey);
  }

  const first = days[0];
  const last = days[days.length - 1];
  // 1日・3日表示は月日だけでもスマートフォンの幅いっぱいになるため、年を足すと見切れる。
  // 週表示（desktopOnly）は幅に余裕があるため、そちらは従来どおり年も出す。
  const year = view === "day1" || view === "day3" ? "" : `${first.slice(0, 4)}年`;

  if (first === last) {
    return {
      year,
      main: formatMonthDay(first),
      weekday: { label: weekdayLabel(first), tone: weekdayTone(first) },
    };
  }

  // 同じ月に収まる範囲では終わりの月を繰り返さない。読む必要があるのは変わる側だけで、
  // 繰り返すと数字の並びが長くなって、どこが範囲の切れ目か掴みにくくなる。
  // 年をまたぐときだけ終わりにも年を添える（週表示は年末年始をまたぐ）。
  const tail =
    first.slice(0, 4) !== last.slice(0, 4)
      ? `${last.slice(0, 4)}年${formatMonthDay(last)}`
      : first.slice(5, 7) === last.slice(5, 7)
        ? `${Number(last.slice(8, 10))}日`
        : formatMonthDay(last);

  return { year, main: `${formatMonthDay(first)} – ${tail}`, weekday: null };
}

function formatMonthDay(dateKey: string): string {
  return `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`;
}
