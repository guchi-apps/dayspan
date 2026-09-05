"use client";

import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import {
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
} from "lucide-react";

import { AppMenuButton } from "@/components/nav/app-drawer";
import { BottomNav } from "@/components/nav/main-nav";
import { OFFLINE_WRITE_MESSAGE, OfflineNotice } from "@/components/offline/offline-notice";
import { useWarmOfflinePage } from "@/components/offline/offline-page-cache";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { Button } from "@/components/ui/button";
import { LinearProgress } from "@/components/ui/linear-progress";
import { WorkRecordDialog, type WorkDraft } from "@/components/work/work-record-dialog";
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
import { rememberCalendarView } from "@/lib/calendar-view-memory";
import { cn } from "@/lib/utils";
import type { PlaceCatalog } from "@/services/notion/places";
import type { TagCatalog } from "@/services/notion/tag-options";
import type { RunningActivityItem } from "@/types/activity";
import type {
  CalendarEventItem,
  CalendarLoadResult,
  ReminderItem,
  TaskEventStage,
  TaskItem,
  TaskLinkTarget,
  TravelItem,
} from "@/types/calendar";
import type { TravelSettings } from "@/services/travel/settings";
import { coversDate, type WorkCapabilities } from "@/types/work";

import { CalendarGridSkeleton } from "./calendar-skeleton";
import { dateKeyPlusMinutes, isoToLocalInput, localInputToIso } from "./datetime-fields";
import { dayTone, weekdayLabel } from "./day-tone";
import { EventDetailDialog } from "./event-detail-dialog";
import { duplicateEventDraft, toEventDraft, type EventDraft } from "./event-form";
import { ItemDialog, type AddableKind, type ItemDrafts, type ItemKind } from "./item-dialog";
import { createCalendarDateUtils, type CalendarDateUtils } from "./item-layout";
import { ContinuousMonthView } from "./continuous-month-view";
import { QuickEventSheet, toQuickEventDraft, type QuickEventDraft } from "./quick-event-sheet";
import { ReminderDetailDialog } from "./reminder-detail-dialog";
import { toReminderDraft } from "./reminder-form";
import { TaskDetailDialog } from "./task-detail-dialog";
import { TaskLinkDialog } from "./task-link-dialog";
import { toTaskDraft } from "./task-form";
import { TimeGridView } from "./time-grid-view";
import { TravelDetailDialog } from "./travel-detail-dialog";
import { toTravelDraft } from "./travel-form";
import {
  monthsOfRanges,
  taskRanges,
  useCalendarChunks,
  type TouchedRange,
} from "./use-calendar-chunks";
import type { AllDayDragCommit, DragCommit } from "./use-grid-drag";
import type { SlotRangeCommit } from "./use-slot-range";

// 日付だけが決まっている追加（右下の「＋」・月表示の長押し）で使う開始時刻。
const DEFAULT_START_MINUTES = 9 * 60;

// タスクの期限は、その日のうちに片付ける想定の時刻から始める（予定の既定より遅い）。
const DEFAULT_TASK_DUE_MINUTES = 18 * 60;

// 移動の仮の長さ。押した時点では所要時間が分からないが、出発と到着を同じ時刻にすると
// 開いた瞬間に入力の注意が出るため、直す前提の長さを置いておく。
const DEFAULT_TRAVEL_MINUTES = 30;

// 期間の短い順に並べる。同じ並びの中で右へ行くほど広い範囲を見ることになり、
// 「今いる形式より広く／狭く見たい」がどちら向きに押せばよいか迷わずに済む。
const VIEW_LABELS: { view: CalendarView; label: string; desktopOnly?: boolean }[] = [
  { view: "day1", label: "1日" },
  { view: "day3", label: "3日" },
  { view: "day7", label: "週", desktopOnly: true },
  { view: "month", label: "月" },
];

/**
 * 勤務記録DB（docs/spec.md §34）のうち、日付ヘッダーのスロットから入力するのに要るもの。
 *
 * どれも `NotionConnection` の1行から決まる値で、カレンダーはその行を既に読んでいる。
 * Notionへの往復は増えない（勤務場所の選択肢もタグ・種類と同じ `loadTagCatalog` で読み終えている）。
 */
export type CalendarWorkContext = {
  /** データソースと必須プロパティが揃っているか。揃っていなければスロットを押せる形にしない。 */
  writable: boolean;
  /** 出張扱いにする勤務場所の名前。 */
  tripPlaces: string[];
  /** 出張・年休・会社休業日・申請・メモが使えるか。 */
  capabilities: WorkCapabilities;
};

export function CalendarShell({
  view,
  anchorKey,
  days,
  weeks,
  dataPromise,
  tagCatalogPromise,
  placeCatalogPromise,
  initialRunningActivity,
  activityCalendarIds,
  travelSettings,
  work,
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
  /**
   * 記録中の活動（docs/spec.md §27）。開始・停止は記録の画面で行うため、ここでは表示だけに使う。
   * まだGoogleに予定が無いぶんを時間グリッドへ帯として描く。
   */
  initialRunningActivity: RunningActivityItem | null;
  /**
   * 活動記録の保存先に選ばれているカレンダー（issue #241）。
   * ここに入っている予定は、時間グリッドでは塗りを落として描き、月表示には出さない。
   */
  activityCalendarIds: string[];
  /** 移動の既定値（docs/spec.md §29）。予定から移動を足すときの初期値に使う。 */
  travelSettings: TravelSettings;
  /** 勤務記録の入力に要るもの（issue #532）。 */
  work: CalendarWorkContext;
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

  // オフラインでこの画面を開けるよう、表示中にHTMLを保存しておく（issue #321）。
  // ナビからの移動はソフトナビゲーションで、Service Worker が保存できないため。
  useWarmOfflinePage("/calendar");

  // 月のデータを取りにいっているか。取得はSuspense境界の内側で起きるが、
  // 進行の表示はヘッダー直下（境界の外）にあるため、ここまで上げてもらう。
  const [windowLoading, setWindowLoading] = useState(false);
  const utils = useMemo(() => createCalendarDateUtils(timeZone), [timeZone]);

  // いま描いている表示形式・日付を、次に開いたときの初期表示として覚える（issue #279）。
  // 覚えるのは「URLに出ている状態」で、開いた直後（サーバーが描いた状態）と、前へ・次へ・
  // スワイプ・表示形式の切り替えのあとがここを通る。月表示のスクロールだけは props が
  // 変わらないため、URLを書き換えている syncMonthUrl の側で覚える。
  useEffect(() => {
    rememberCalendarView(view, anchorKey);
  }, [view, anchorKey]);

  // 日ごとの列・終日エリアは memo で包んであるため、判定に使う集合の参照を保つ。
  // 描くたびに作り直すと、活動記録の有無に関わらず全ての列が描き直しになる。
  const activityCalendars = useMemo(
    () => new Set(activityCalendarIds),
    [activityCalendarIds],
  );

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
  const [scrollTarget, setScrollTarget] = useState<{ month: string; day?: string; nonce: number }>(
    () => ({
      month: anchorKey.slice(0, 7),
      // 今月を開いたときは、今日を含む週を画面中央へ置く（「今日」ボタンと同じ位置）。
      // 月の先頭週を上端に合わせるだけだと、月末の今日が画面の外に出ることがある。
      // 別の月から開いたときは行き先に今日が無いため、従来どおり先頭週を上端にそろえる。
      day:
        anchorKey.slice(0, 7) === utils.todayKey().slice(0, 7) ? utils.todayKey() : undefined,
      nonce: 0,
    }),
  );

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
  const [viewingTravel, setViewingTravel] = useState<TravelItem | null>(null);
  // タスクを紐づける相手の予定（docs/spec.md §31）。予定の詳細から開く。
  const [linkingEvent, setLinkingEvent] = useState<CalendarEventItem | null>(null);

  /**
   * 記録中の帯を押したとき。開始・停止は記録の画面で行う（docs/spec.md §27）。
   * カレンダーに出しているのは、まだ予定になっていないぶんの表示だけ。
   */
  const openActivity = () => {
    startTransition(() => router.push("/activity"));
  };

  const closeDialogs = () => {
    setItemDialog(null);
    setQuickDraft(null);
    setViewingEvent(null);
    setViewingTask(null);
    setViewingReminder(null);
    setViewingTravel(null);
    setLinkingEvent(null);
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
  const openTravel = (travel: TravelItem) => setViewingTravel(travel);

  /**
   * 予定の表示画面から、その予定に紐づく移動へ移る（issue #327）。
   *
   * 移動は時間グリッドでは予定の背面に置くため、時間が丸ごと重なると押せない。
   * 予定の側からたどれば、画面のどこに何が乗っているかに関係なく開ける。
   */
  const openTravelFromEvent = (travel: TravelItem) => {
    setViewingEvent(null);
    setViewingTravel(travel);
  };

  const editTravel = (travel: TravelItem) => {
    if (offline) return;
    setViewingTravel(null);
    setItemDialog({ initialKind: "travel", drafts: { travel: toTravelDraft(travel, timeZone) } });
  };

  /**
   * 予定から移動を足す（docs/spec.md §29）。
   *
   * 目的地はその予定の場所、到着時刻は予定の開始時刻を初期値にする。出発地は設定の既定の
   * 出発地（自宅など）から入れる。押した時点では所要時間が分からないが、出発と到着を同じ時刻に
   * すると開いた瞬間に「到着が出発より後になるように」と出る。仮の長さを置いてから、
   * 「所要時間を調べる」か手入力で直してもらう。
   */
  const addTravelForEvent = (event: CalendarEventItem) => {
    if (offline) return;
    setViewingEvent(null);
    setItemDialog({
      initialKind: "travel",
      drafts: {
        travel: {
          origin: travelSettings.defaultOrigin ?? "",
          destination: event.location ?? "",
          mode: travelSettings.defaultMode,
          departAt: isoToLocalInput(
            new Date(new Date(event.start).getTime() - DEFAULT_TRAVEL_MINUTES * 60_000).toISOString(),
            timeZone,
          ),
          arriveAt: isoToLocalInput(event.start, timeZone),
          linkedEvent: { id: event.id, calendarId: event.calendarId, endAt: event.end },
          roundTrip: travelSettings.roundTrip,
        },
      },
    });
  };

  /** 予定の詳細から、この予定にタスクを紐づける（docs/spec.md §31）。 */
  const linkTaskForEvent = (event: CalendarEventItem) => {
    if (offline) return;
    setViewingEvent(null);
    setLinkingEvent(event);
  };

  /**
   * 紐づけダイアログから「新しいタスクを作る」。入力画面を紐づけ先つきで開く。
   * 行き先の日付はタスクを作ったあとの紐づけで入るため、ここでは未設定のままにする。
   */
  const createTaskForEvent = (
    event: CalendarEventItem,
    stage: TaskEventStage,
    target: TaskLinkTarget,
  ) => {
    setLinkingEvent(null);
    setItemDialog({
      initialKind: "task",
      drafts: {
        task: {
          dueMode: "none",
          due: "",
          linkTo: {
            calendarId: event.calendarId,
            eventId: event.id,
            eventTitle: event.title,
            stage,
            target,
          },
        },
      },
    });
  };

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
  const openAdd = (available: Record<AddableKind, boolean>) => {
    const drafts: ItemDrafts = {};
    if (available.event) drafts.event = newEventDraft(defaultDayKey, DEFAULT_START_MINUTES);
    if (available.task) {
      drafts.task = {
        dueMode: "datetime",
        due: dateKeyPlusMinutes(defaultDayKey, DEFAULT_TASK_DUE_MINUTES),
      };
    }
    if (available.travel) {
      // 単独の移動は往復の起点になる予定が無いため、行きだけを作る。
      drafts.travel = {
        origin: travelSettings.defaultOrigin ?? "",
        destination: "",
        mode: travelSettings.defaultMode,
        departAt: dateKeyPlusMinutes(defaultDayKey, DEFAULT_START_MINUTES),
        arriveAt: dateKeyPlusMinutes(defaultDayKey, DEFAULT_START_MINUTES + 30),
      };
    }

    // 「＋」は予定を足す操作として使われることが多い。作れるなら予定から開く。
    const initialKind: AddableKind = available.event ? "event" : available.task ? "task" : "travel";
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
        {/* どの画面幅でも左上をメニューにする（issue #328・#463）。画面の移動はすべてここから。 */}
        <AppMenuButton current="calendar" activityRunning={initialRunningActivity !== null} />

        {/*
          アイコンはPCだけに出す。他の画面（タスク・日付リマインド）も同じ位置にアイコンがあり、
          カレンダーだけ日付から始まると、同じアプリの中で先頭の位置が揃わないため。
          カレンダーアイコンをクリックすると今日の日付に飛ぶ。狭い画面で今日へ戻る操作は、
          下部ナビの「カレンダー」が同じことをする（issue #175）。
          他の画面と違って画面名を添えないのは、この直後の年月の見出しがその役目を持つため
          （「カレンダー 2026年 8月」と並べても読める情報が増えない）。
        */}
        <Button
          variant="ghost"
          onClick={goToday}
          className="hidden shrink-0 px-2 py-1.5 font-semibold md:flex"
          aria-label="今日に飛ぶ"
        >
          <CalendarDays className="size-5" />
        </Button>

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
            {/*
              狭い画面では月だけに切り替える。日と曜日は列ヘッダーに出ているため、
              ここで繰り返すと入り切らずに truncate され、いま見ている期間そのものが読めなくなる。
              表示中の幅で文字列を選ぶとサーバーとブラウザで結果が変わるため、両方を描いてCSSで隠す。
            */}
            {headerLabel.compact ? (
              <>
                <span className="md:hidden">{headerLabel.compact}</span>
                <span className="hidden md:inline">{headerLabel.main}</span>
              </>
            ) : (
              headerLabel.main
            )}
          </span>
          {headerLabel.weekday && (
            <span
              className={cn(
                "type-label-medium md:type-title-small shrink-0",
                headerLabel.compact && "hidden md:inline",
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
        {/* 勤務・場所・設定はヘッダーに置かない（issue #463）。どの画面幅でもドロワーが開くように
            なったため、この帯に3つ並べる理由が無くなった（docs/spec.md §4・§9・§34）。 */}
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
          viewingTravel={viewingTravel}
          linkingEvent={linkingEvent}
          virtual={virtual}
          onVisibleMonthChange={handleVisibleMonthChange}
          onVisibleWeekChange={handleVisibleWeekChange}
          onSwipe={moveDays}
          onSelectDay={(dateKey) => navigate("day1", dateKey)}
          onOpenEvent={openEvent}
          onOpenTask={openTask}
          onOpenReminder={openReminder}
          onOpenTravel={openTravel}
          onOpenTravelForEvent={openTravelFromEvent}
          onEditEvent={editEvent}
          onDuplicateEvent={duplicateEvent}
          onEditTask={editTask}
          onEditReminder={editReminder}
          onEditTravel={editTravel}
          onAddTravelForEvent={addTravelForEvent}
          onLinkTaskForEvent={linkTaskForEvent}
          onCreateTaskForEvent={createTaskForEvent}
          onSelectSlot={(dateKey, minutes) => {
            if (offline) return;
            setQuickDraft(toQuickEventDraft(dateKey, minutes));
          }}
          onSelectRange={({ dateKey, startMinutes, endMinutes }) => {
            if (offline) return;
            setQuickDraft(toQuickEventDraft(dateKey, startMinutes, endMinutes));
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
          runningActivity={initialRunningActivity}
          activityCalendars={activityCalendars}
          onOpenActivity={openActivity}
          work={work}
        />
      </Suspense>

      <BottomNav
        current="calendar"
        activityRunning={initialRunningActivity !== null}
        onCalendarClick={goToday}
      />
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
  rememberCalendarView("month", `${month}-01`);
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
  viewingTravel,
  linkingEvent,
  virtual,
  onVisibleMonthChange,
  onVisibleWeekChange,
  onSwipe,
  onSelectDay,
  onOpenEvent,
  onOpenTask,
  onOpenReminder,
  onOpenTravel,
  onOpenTravelForEvent,
  onEditEvent,
  onDuplicateEvent,
  onEditTask,
  onEditReminder,
  onEditTravel,
  onAddTravelForEvent,
  onLinkTaskForEvent,
  onCreateTaskForEvent,
  onSelectSlot,
  onSelectRange,
  onQuickAddOnDay,
  onOpenEventForm,
  onDragCommit,
  onAllDayDragCommit,
  onAdd,
  onCloseDialogs,
  onRefreshAll,
  onLoadingChange,
  runningActivity,
  activityCalendars,
  onOpenActivity,
  work,
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
  viewingTravel: TravelItem | null;
  /** タスクを紐づける相手の予定（docs/spec.md §31）。 */
  linkingEvent: CalendarEventItem | null;
  virtual: { firstWeekKey: string; weekCount: number };
  onVisibleMonthChange: (monthKey: string) => void;
  onVisibleWeekChange: (weekKey: string) => void;
  onSwipe: (deltaDays: number) => void;
  onSelectDay: (dateKey: string) => void;
  onOpenEvent: (event: CalendarEventItem) => void;
  onOpenTask: (task: TaskItem) => void;
  onOpenReminder: (reminder: ReminderItem) => void;
  onOpenTravel: (travel: TravelItem) => void;
  /** 予定の表示画面から、その予定に紐づく移動を開く（issue #327）。 */
  onOpenTravelForEvent: (travel: TravelItem) => void;
  onEditEvent: (event: CalendarEventItem) => void;
  onDuplicateEvent: (event: CalendarEventItem) => void;
  onEditTask: (task: TaskItem) => void;
  onEditReminder: (reminder: ReminderItem) => void;
  onEditTravel: (travel: TravelItem) => void;
  /** 予定の詳細から移動を足す。目的地・到着時刻はその予定から埋める。 */
  onAddTravelForEvent: (event: CalendarEventItem) => void;
  /** 予定の詳細からタスクを紐づける（docs/spec.md §31）。 */
  onLinkTaskForEvent: (event: CalendarEventItem) => void;
  /** 紐づけダイアログから、紐づけた状態のタスクを新しく作る。 */
  onCreateTaskForEvent: (
    event: CalendarEventItem,
    stage: TaskEventStage,
    target: TaskLinkTarget,
  ) => void;
  onSelectSlot: (dateKey: string, minutes: number) => void;
  onSelectRange: (commit: SlotRangeCommit) => void;
  onQuickAddOnDay: (dateKey: string) => void;
  onOpenEventForm: (draft: EventDraft) => void;
  onDragCommit: (commit: DragCommit) => void;
  onAllDayDragCommit: (commit: AllDayDragCommit) => void;
  /** 右下の「＋」。作れる種類を渡し、ひな型は呼び出し側で作る。 */
  onAdd: (available: Record<AddableKind, boolean>) => void;
  onCloseDialogs: () => void;
  onRefreshAll: () => void;
  onLoadingChange: (loading: boolean) => void;
  runningActivity: RunningActivityItem | null;
  /** 活動記録の保存先に選ばれているカレンダー（issue #241）。 */
  activityCalendars: ReadonlySet<string>;
  /** 記録中の帯を押したとき。開始・停止は記録の画面で行う。 */
  onOpenActivity: () => void;
  /** 勤務記録の入力に要るもの（issue #532）。 */
  work: CalendarWorkContext;
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
   * 勤務場所の色（docs/spec.md §34）。選択肢はNotionのプロパティ定義が一次情報源で、
   * タグ・種類と同じ経路（loadTagCatalog）で既に読んでいる。参照を保って渡さないと、
   * memo で包んだ日ごとの列が毎回描き直しになる。
   */
  const workPlaceOptions = useMemo(() => tagCatalog.work ?? [], [tagCatalog.work]);

  /**
   * 日付ヘッダーの勤務スロットから開く入力（issue #532）。
   *
   * 勤務の画面（/work）と同じ `WorkRecordDialog` をそのまま開く。新しい入力画面は作らない。
   * その日に記録があれば編集、無ければ新規（その日付・勤務のタブ）で開くのも `openDay()` と
   * 同じ形にする。新規で送ると重なりをサーバーが断る（1日1件・docs/spec.md §34）ため、
   * 開く前にここで分けておく必要がある。
   *
   * 他の入力（`itemDialog` など）は状態を外側の `CalendarShell` に置いているが、あれらは
   * 日付だけからひな型を作れる。勤務はその日の**既存の記録**を引く必要があり、それが解決するのは
   * `<Suspense>` の内側（`use(dataPromise)`）のここから。外側で待つと「ヘッダーは取得を待たずに
   * 描く」という作りが崩れるため、状態ごとこちらへ置く（issue #532 計画レビューG1の指摘）。
   */
  const [workDraft, setWorkDraft] = useState<WorkDraft | null>(null);

  // DayHeaderPane は memo で包んである。参照が毎回変わると日付ヘッダーが描き直しになる。
  const workRecords = data.workRecords;
  const openWork = useCallback(
    (dateKey: string) => {
      const existing = workRecords.find((record) => coversDate(record, dateKey));
      setWorkDraft(
        existing
          ? { mode: "edit", record: existing }
          : { mode: "create", startDate: dateKey, kind: "work" },
      );
    },
    [workRecords],
  );

  /**
   * 月表示に出す予定。活動記録は除く（issue #241）。
   *
   * 月表示は1日に数件しか置けない。睡眠のように毎日必ず入る記録がその枠を占めると、
   * その日に何があるかが読めなくなる。記録は何時から何時までという時刻の情報が主で、
   * 日単位の一覧である月表示では読み取れないため、時間グリッド側にだけ残す。
   */
  const monthEvents = useMemo(
    () =>
      activityCalendars.size === 0
        ? data.events
        : data.events.filter((event) => !activityCalendars.has(event.calendarId)),
    [data.events, activityCalendars],
  );

  /**
   * 保存・削除のあとの取り直し。
   *
   * 月表示は変わった月だけを取り直す。ページごと描き直すと、表示中の月すべてを
   * 外部APIから取り直すことになり、保存のたびにその待ち時間が乗る。
   */
  const handleSaved = (touched: TouchedRange[] | null) => {
    onCloseDialogs();
    setWorkDraft(null);

    if (view !== "month") {
      onRefreshAll();
      return;
    }

    data.invalidate(touched === null ? null : monthsOfRanges(touched));
  };

  /**
   * 表示画面を開いたままの変更（紐づけの操作）。閉じずに、変わった期間だけ取り直す。
   * 続けて段階を選び直せるようにするため、押すたびにダイアログを閉じない。
   */
  const handleChanged = (touched: TouchedRange[] | null) => {
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
          events={monthEvents}
          tasks={data.tasks}
          reminders={data.reminders}
          travels={data.travels}
          workRecords={data.workRecords}
          workPlaceOptions={workPlaceOptions}
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
          onOpenTravel={onOpenTravel}
        />
      ) : (
        <TimeGridView
          days={days}
          events={data.events}
          tasks={data.tasks}
          reminders={data.reminders}
          travels={data.travels}
          workRecords={data.workRecords}
          workPlaceOptions={workPlaceOptions}
          workWritable={work.writable}
          onOpenWork={openWork}
          runningActivity={runningActivity}
          activityCalendarIds={activityCalendars}
          utils={utils}
          onOpenEvent={onOpenEvent}
          onOpenTask={onOpenTask}
          onOpenReminder={onOpenReminder}
          onOpenTravel={onOpenTravel}
          onOpenActivity={onOpenActivity}
          onSelectSlot={onSelectSlot}
          onSelectRange={onSelectRange}
          onDragCommit={onDragCommit}
          onAllDayDragCommit={onAllDayDragCommit}
          onSwipe={onSwipe}
          readOnly={offline}
        />
      )}

      <AddButton
        available={{
          event: !offline && data.calendars.length > 0,
          task: !offline && data.notionReady,
          // 移動の本体はDaySpanのDBにあるため、外部連携が済んでいなくても作れる。
          travel: !offline,
        }}
        onAdd={onAdd}
      />

      {/*
        勤務・出張・年休・会社休業日の入力（docs/spec.md §34）。勤務の画面と同じダイアログで、
        保存後は他の入力と同じ取り直しの経路に乗せる。開くのは時間グリッドの日付ヘッダーからだけ
        （月表示はセルの押下が「1日表示へ移動」に決まっている・issue #532）。
      */}
      {workDraft && (
        <WorkRecordDialog
          draft={workDraft}
          placeOptions={workPlaceOptions}
          tripPlaces={work.tripPlaces}
          capabilities={work.capabilities}
          todayKey={utils.todayKey()}
          onClose={() => setWorkDraft(null)}
          onSaved={() => handleSaved(null)}
        />
      )}

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
          onAddTravel={() => onAddTravelForEvent(viewingEvent)}
          // この予定のために作った移動。往路・復路の2件が同じ予定を指す。
          linkedTravels={data.travels.filter(
            (travel) => travel.linkedEventId === viewingEvent.id,
          )}
          onOpenTravel={onOpenTravelForEvent}
          onLinkTask={() => onLinkTaskForEvent(viewingEvent)}
          // 消すと紐づけが外れるタスク。確認の前に示す（docs/spec.md §31）。
          linkedTasks={data.tasks
            .filter((task) => task.links.some((link) => link.eventId === viewingEvent.id))
            .map((task) => task.title)}
          // 場所を地図で開くとき、登録済みの場所なら座標で開く（issue #426）。
          places={placeCatalog.places}
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
          onChanged={handleChanged}
        />
      )}

      {/* 予定にタスクを紐づける（docs/spec.md §31）。 */}
      {linkingEvent && (
        <TaskLinkDialog
          event={linkingEvent}
          timeZone={timeZone}
          onCancel={onCloseDialogs}
          onCreateTask={(stage, target) => onCreateTaskForEvent(linkingEvent, stage, target)}
          onLinked={handleSaved}
        />
      )}

      {viewingTravel && (
        <TravelDetailDialog
          travel={viewingTravel}
          timeZone={timeZone}
          readOnly={offline}
          onClose={onCloseDialogs}
          onEdit={() => onEditTravel(viewingTravel)}
          onDeleted={handleSaved}
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

/** YYYY-MM-DD を日数分ずらす。UTC正午で扱い、タイムゾーンによる日付ずれを避ける。 */
function shiftDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * 画面右下の「＋」。押すと入力画面が開き、そこで予定・タスク・移動を切り替える
 * （docs/spec.md §15）。何を作るかは開いてからでも選べるため、ここでは種類を選ばせない。
 * 日付リマインドはこの一覧に出さない（AddableKind の理由を参照）。
 */
function AddButton({
  available,
  onAdd,
}: {
  available: Record<AddableKind, boolean>;
  onAdd: (available: Record<AddableKind, boolean>) => void;
}) {
  if (!available.event && !available.task && !available.travel) return null;

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
  /**
   * 狭い画面で main の代わりに出す短い表記（「8月」「8月 – 9月」）。
   * null なら幅に関わらず main を使う。
   */
  compact: string | null;
  /** 1日表示のときだけ。曜日はグリッドと同じ配色にする */
  weekday: { label: string; tone: string | null } | null;
};

function formatMonthLabel(monthKey: string): HeaderLabel {
  return {
    year: `${monthKey.slice(0, 4)}年`,
    main: `${Number(monthKey.slice(5, 7))}月`,
    compact: null,
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

  // 1日・3日表示は、狭い画面では月日を並べるだけで幅を使い切る。列ヘッダーに日と曜日が
  // 出ているため、狭いときは月だけに落として範囲が読めなくなるのを避ける。
  // 週表示（desktopOnly）は幅に余裕があり、月だけに落とす必要が無い。
  const compact =
    view === "day1" || view === "day3" ? formatMonthRange(first, last) : null;

  if (first === last) {
    return {
      year,
      main: formatMonthDay(first),
      compact,
      weekday: { label: weekdayLabel(first), tone: dayTone(first) },
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

  return { year, main: `${formatMonthDay(first)} – ${tail}`, compact, weekday: null };
}

function formatMonthDay(dateKey: string): string {
  return `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`;
}

/** 「8月」。月をまたぐ範囲だけ「8月 – 9月」にする */
function formatMonthRange(first: string, last: string): string {
  const firstMonth = `${Number(first.slice(5, 7))}月`;
  if (first.slice(0, 7) === last.slice(0, 7)) return firstMonth;
  return `${firstMonth} – ${Number(last.slice(5, 7))}月`;
}
