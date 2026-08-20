"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import {
  ArrowUpDown,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Plus,
  RefreshCw,
  Tag,
} from "lucide-react";

import { BottomNav, HeaderNav } from "@/components/nav/main-nav";
import { OFFLINE_WRITE_MESSAGE, OfflineNotice } from "@/components/offline/offline-notice";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { LinearProgress } from "@/components/ui/linear-progress";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { TaskDetailDialog } from "@/components/calendar/task-detail-dialog";
import { ItemDialog, type ItemDrafts } from "@/components/calendar/item-dialog";
import { toTaskDraft } from "@/components/calendar/task-form";
import { TagChip, TagChipList } from "@/components/tags/tag-chip";
import { tagColorOf } from "@/components/tags/tag-color";
import { useTaskViewPrefs } from "@/components/tasks/use-task-view-prefs";
import { cn } from "@/lib/utils";
import {
  classifyTasks,
  groupTasksByTag,
  NO_TAG_GROUP_KEY,
  overdueDaysLabel,
  sortDoneTasks,
  sortTasks,
  TASK_BUCKET_LABELS,
  type TaskBucketKey,
} from "@/services/notion/task-buckets";
import type { TagCatalog, TagOption } from "@/services/notion/tag-options";
import type { PlaceCatalog } from "@/services/notion/places";
import type { TaskItem, TaskPriority, WritableCalendar } from "@/types/calendar";
import { dateKeyPlusMinutes } from "@/components/calendar/datetime-fields";

/** 期限での分類の並び。完了は分類の軸によらず末尾へ別に置くため含めない。 */
const DUE_ORDER: Exclude<TaskBucketKey, "done">[] = ["overdue", "today", "upcoming", "someday"];

const DEFAULT_TASK_DUE_MINUTES = 18 * 60;

/** 画面に並べる1区分。期限での分類とタグでの分類のどちらもこの形にしてから描く。 */
type TaskSection = {
  key: string;
  /** 見出しの文字。タグの区分ではタグ名がそのまま入る。 */
  label: string;
  /** タグの区分かどうか。見出しをチップで描き、行からそのタグを外すのに使う。 */
  tagName: string | null;
  tasks: TaskItem[];
};

export function TaskList({
  tasks,
  tagCatalog,
  timeZone,
  loadError,
  calendars = [],
  placeCatalog = { ready: false, places: [] },
  weekStartsOn = 0,
  activityRunning = false,
}: {
  tasks: TaskItem[];
  /** 登録済みのタグ・種類。色の表示と入力の候補に使う。 */
  tagCatalog: TagCatalog;
  timeZone: string;
  loadError: string | null;
  calendars?: WritableCalendar[];
  placeCatalog?: PlaceCatalog;
  weekStartsOn?: number;
  /** 活動を記録中かどうか。ナビの記録の項目へ印を出すためだけに使う（docs/spec.md §27）。 */
  activityRunning?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // 分類の軸・並び順・完了の開閉は、選び直すまで端末に残す（issue #286）。
  const { groupBy, sort, doneOpen, setGroupBy, setSort, setDoneOpen } = useTaskViewPrefs();
  const [itemDialog, setItemDialog] = useState<ItemDrafts | null>(null);
  // タップした直後は表示専用画面を開く。編集アイコンを押したときだけ draft へ切り替える。
  const [viewingTask, setViewingTask] = useState<TaskItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // オフライン中は書き込みを止める（docs/spec.md §21）。
  const offline = useOffline();
  useReconnectRefresh();

  const utils = useMemo(() => createCalendarDateUtils(timeZone), [timeZone]);
  const todayKey = utils.todayKey();
  const tagOptions = useMemo(() => tagCatalog.task ?? [], [tagCatalog]);

  const buckets = useMemo(
    () => classifyTasks(tasks, todayKey, utils.itemDateKey),
    [tasks, todayKey, utils],
  );

  // 分類の軸にタグを出してよいか。選択肢はNotionの取得に失敗しても空になり、その失敗は
  // 画面には出ない（services/notion/tag-options.ts）。タグが1つも無いまま切り替えられると、
  // 全件が「タグなし」の1区分に入り、壊れたように見える。タスク側にタグが付いていれば
  // 見出しの色と並びが既定に落ちるだけで分類はできるため、両方が空のときだけ隠す。
  const tagsAvailable =
    tagOptions.length > 0 || tasks.some((task) => !task.done && task.tags.length > 0);
  const effectiveGroupBy = tagsAvailable ? groupBy : "due";

  const sections = useMemo<TaskSection[]>(() => {
    if (effectiveGroupBy === "tag") {
      return groupTasksByTag(
        tasks,
        tagOptions.map((option) => option.name),
        sort,
      ).map((group) => ({
        key: group.key,
        label: group.name,
        // タグなしの区分だけは、チップではなく普通の文字で見出しを出す。
        tagName: group.key === NO_TAG_GROUP_KEY ? null : group.name,
        tasks: group.tasks,
      }));
    }

    return DUE_ORDER.map((key) => ({
      key,
      label: TASK_BUCKET_LABELS[key],
      tagName: null,
      tasks: sortTasks(buckets[key], sort),
    }));
  }, [effectiveGroupBy, sort, tasks, tagOptions, buckets]);

  const doneTasks = useMemo(() => sortDoneTasks(buckets.done), [buckets]);

  const patchTaskDone = async (task: TaskItem, done: boolean) => {
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
  };

  const toggleDone = async (task: TaskItem, done: boolean) => {
    setBusyId(task.id);
    setError(null);
    try {
      await patchTaskDone(task, done);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新できませんでした。");
    } finally {
      setBusyId(null);
      startTransition(() => router.refresh());
    }
  };

  /** 表示画面からの完了切り替え。表示画面は自前で完了状態を持つため、ここでは取り直すだけでよい。 */
  const toggleDoneFromDetail = async (task: TaskItem, done: boolean) => {
    await patchTaskDone(task, done);
    startTransition(() => router.refresh());
  };

  const editTask = (task: TaskItem) => {
    if (offline) return;
    setViewingTask(null);
    setItemDialog({ task: toTaskDraft(task, timeZone) });
  };

  /**
   * 右下の「＋」からの追加。この画面で作れるのはタスクだけで、日付リマインドは
   * 専用一覧（/reminders）に寄せている（docs/spec.md §9・§15）。ひな型が1つのため
   * ItemDialog に切り替えは出ず、タスクの入力画面がそのまま開く。
   */
  const openAdd = () => {
    const drafts: ItemDrafts = {
      task: {
        dueMode: "datetime",
        due: dateKeyPlusMinutes(todayKey, DEFAULT_TASK_DUE_MINUTES),
      },
    };
    setItemDialog(drafts);
  };

  const renderTask = (task: TaskItem, section: TaskSection) => (
    <TaskRow
      key={task.id}
      task={task}
      // タグの区分では、見出しに出ているタグを行から外す。同じチップが二重に出るのを避けつつ、
      // 兼ねている他のタグは残して、どの区分にも出ていることが分かるようにする。
      hideTagName={section.tagName}
      tagOptions={tagOptions}
      utils={utils}
      todayKey={todayKey}
      disabled={busyId === task.id || offline}
      onToggleDone={(done) => toggleDone(task, done)}
      onOpen={() => setViewingTask(task)}
    />
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-1 bg-surface-container-low px-2 py-2">
        <div className="flex shrink-0 items-center gap-1 font-semibold">
          <ListChecks className="size-5" />
          <span className="hidden lg:inline">DaySpan</span>
        </div>

        <HeaderNav current="tasks" activityRunning={activityRunning} />

        <span className="flex-1" />

        {tagsAvailable && (
          <Button
            variant="outline"
            size="sm"
            aria-label={effectiveGroupBy === "due" ? "タグで分類する" : "期限で分類する"}
            onClick={() => setGroupBy(effectiveGroupBy === "due" ? "tag" : "due")}
          >
            {effectiveGroupBy === "due" ? (
              <CalendarClock className="size-4" />
            ) : (
              <Tag className="size-4" />
            )}
            {effectiveGroupBy === "due" ? "期限" : "タグ"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          aria-label={sort === "due" ? "優先度順に並べ替える" : "期限順に並べ替える"}
          onClick={() => setSort(sort === "due" ? "priority" : "due")}
        >
          <ArrowUpDown className="size-4" />
          {sort === "due" ? "期限順" : "優先度順"}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="再取得"
          // オフライン中に押しても、再接続まで終わらない読み込みが始まるだけになる。
          disabled={pending || offline}
          onClick={() => startTransition(() => router.refresh())}
        >
          <RefreshCw className="size-4" />
        </Button>
      </header>

      <LinearProgress active={pending || busyId !== null} />

      <OfflineNotice />

      {(loadError || error) && (
        <div className="bg-error-container/70 text-on-error-container px-3 py-2 text-xs">{loadError ?? error}</div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-24">
        {sections.map((section) => {
          if (section.tasks.length === 0) return null;

          return (
            <section key={section.key}>
              <h2 className="sticky top-0 z-10 flex items-center gap-2 border-b border-rule bg-background/95 px-3 py-1 text-[11px] tracking-widest text-muted-foreground backdrop-blur">
                {section.tagName ? (
                  <TagChip
                    name={section.tagName}
                    color={tagColorOf(tagOptions, section.tagName)}
                    className="tracking-normal"
                  />
                ) : (
                  section.label
                )}
                <span className="text-[10px] opacity-70">{section.tasks.length}</span>
              </h2>

              <ul>{section.tasks.map((task) => renderTask(task, section))}</ul>
            </section>
          );
        })}

        {/* 完了は履歴として残るぶん件数が増え続ける（docs/spec.md §12）。既定では畳んでおき、
            見出しを押したときだけ開く。分類の軸によらず末尾に1つだけ置く。 */}
        {doneTasks.length > 0 && (
          <section>
            <h2 className="sticky top-0 z-10 border-b border-rule bg-background/95 backdrop-blur">
              <button
                type="button"
                className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] tracking-widest text-muted-foreground"
                aria-expanded={doneOpen}
                onClick={() => setDoneOpen(!doneOpen)}
              >
                {doneOpen ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
                {TASK_BUCKET_LABELS.done}
                <span className="text-[10px] opacity-70">{doneTasks.length}</span>
              </button>
            </h2>

            {doneOpen && (
              <ul>
                {doneTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    hideTagName={null}
                    tagOptions={tagOptions}
                    utils={utils}
                    todayKey={todayKey}
                    disabled={busyId === task.id || offline}
                    onToggleDone={(done) => toggleDone(task, done)}
                    onOpen={() => setViewingTask(task)}
                  />
                ))}
              </ul>
            )}
          </section>
        )}

        {tasks.length === 0 && !loadError && (
          <p className="p-6 text-center text-sm text-muted-foreground">タスクがありません。</p>
        )}
      </div>

      <Button
        size="icon"
        className="elevation-3 fixed right-4 bottom-[calc(6rem_+_env(safe-area-inset-bottom))] z-20 size-14 rounded-lg bg-primary-container text-on-primary-container hover:brightness-95 md:bottom-6"
        aria-label="タスクを追加"
        disabled={offline}
        onClick={openAdd}
      >
        <Plus className="size-6" />
      </Button>

      <BottomNav current="tasks" activityRunning={activityRunning} timeZone={timeZone} />

      {itemDialog && (
        <ItemDialog
          initialKind="task"
          drafts={itemDialog}
          calendars={calendars}
          tagCatalog={tagCatalog}
          placeCatalog={placeCatalog}
          timeZone={timeZone}
          weekStartsOn={weekStartsOn}
          onClose={() => setItemDialog(null)}
          onSaved={() => {
            setItemDialog(null);
            startTransition(() => router.refresh());
          }}
        />
      )}

      {viewingTask && (
        <TaskDetailDialog
          task={viewingTask}
          tagOptions={tagCatalog.task ?? []}
          timeZone={timeZone}
          readOnly={offline}
          onClose={() => setViewingTask(null)}
          onEdit={() => editTask(viewingTask)}
          onDeleted={() => {
            setViewingTask(null);
            startTransition(() => router.refresh());
          }}
          onToggleDone={toggleDoneFromDetail}
        />
      )}
    </div>
  );
}

/**
 * タスク1件の行。
 *
 * 1画面に入る件数を増やすため、タスク名は body-medium、日付・タグの行は label-small まで下げ、
 * 上下の余白も詰める（issue #286）。押せる大きさは変えない（チェックボックスは18dpのボックスに
 * 40dpの当たり判定を持つ）。
 */
function TaskRow({
  task,
  hideTagName,
  tagOptions,
  utils,
  todayKey,
  disabled,
  onToggleDone,
  onOpen,
}: {
  task: TaskItem;
  /** 見出しに出ているため行からは外すタグ。期限での分類では null。 */
  hideTagName: string | null;
  tagOptions: TagOption[];
  utils: ReturnType<typeof createCalendarDateUtils>;
  todayKey: string;
  disabled: boolean;
  onToggleDone: (done: boolean) => void;
  onOpen: () => void;
}) {
  const dueKey = task.due ? utils.itemDateKey(task.due) : null;
  const overdue = !task.done && dueKey !== null && dueKey < todayKey;
  const overdueLabel = dueKey !== null && !task.done ? overdueDaysLabel(dueKey, todayKey) : null;
  const tags = hideTagName ? task.tags.filter((name) => name !== hideTagName) : task.tags;

  return (
    <li className="flex items-start gap-2 border-b border-rule/50 py-1.5 pr-3 pl-2">
      <PriorityBar priority={task.priority} />

      <Checkbox
        className="mt-[3px]"
        checked={task.done}
        disabled={disabled}
        aria-label={`${task.title} を完了にする`}
        onCheckedChange={(value) => onToggleDone(value === true)}
      />

      <button type="button" className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div
          className={cn(
            "type-body-medium clip-nowrap",
            task.done && "text-on-surface-variant line-through",
          )}
        >
          {task.title}
        </div>

        <div className="type-label-small flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-normal text-on-surface-variant">
          {task.due && (
            <span className={cn(overdue && "text-destructive")}>
              {formatTaskDate(task.due, task.hasTime, utils, todayKey)}
              {overdueLabel && `・${overdueLabel}`}
            </span>
          )}
          {/* 予定日は期限とは別の日付。分類・並び順は期限のままで、見えるだけ添える。 */}
          {task.planned && (
            <span className="opacity-80">
              予定 {formatTaskDate(task.planned, task.plannedHasTime, utils, todayKey)}
            </span>
          )}
          {task.recurrence && task.recurrence !== "なし" && (
            <span className="opacity-80">{task.recurrence}</span>
          )}
          <TagChipList names={tags} options={tagOptions} />
        </div>
      </button>
    </li>
  );
}

/**
 * 行の左端に出す優先度の帯。
 *
 * バッジで「高」と書くと日付やタグと同じ文字の列に混ざり、縦に並べたときどれが急ぐのか読めない
 * （issue #286）。色だけに意味を持たせないよう、読み上げ用の文字を添える。
 */
function PriorityBar({ priority }: { priority: TaskPriority }) {
  const tone = priority === "高" ? "bg-destructive" : priority === "中" ? "bg-tertiary" : null;

  if (!tone) return <span className="w-[3px] shrink-0" aria-hidden />;

  return (
    <>
      <span className={cn("w-[3px] shrink-0 self-stretch rounded-full", tone)} aria-hidden />
      <span className="sr-only">優先度 {priority}</span>
    </>
  );
}

function formatTaskDate(
  date: string,
  hasTime: boolean,
  utils: ReturnType<typeof createCalendarDateUtils>,
  todayKey: string,
): string {
  const dateKey = utils.itemDateKey(date);
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  // 今年の日付では年を出さない。ほとんどの期限は今年のもので、行の幅を年に使うと
  // 項目名に回せる幅がそのぶん減る。
  const label =
    dateKey.slice(0, 4) === todayKey.slice(0, 4)
      ? `${month}/${day}`
      : `${dateKey.slice(0, 4)}/${month}/${day}`;

  return hasTime ? `${label} ${utils.formatTime(date)}` : label;
}
