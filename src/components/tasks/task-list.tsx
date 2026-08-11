"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { ArrowUpDown, ListChecks, Plus, RefreshCw } from "lucide-react";

import { BottomNav, HeaderNav } from "@/components/nav/main-nav";
import { OFFLINE_WRITE_MESSAGE, OfflineNotice } from "@/components/offline/offline-notice";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { LinearProgress } from "@/components/ui/linear-progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { TaskDetailDialog } from "@/components/calendar/task-detail-dialog";
import { ItemDialog, type ItemDrafts } from "@/components/calendar/item-dialog";
import { toTaskDraft, type TaskDraft } from "@/components/calendar/task-form";
import { TagChipList } from "@/components/tags/tag-chip";
import { cn } from "@/lib/utils";
import {
  classifyTasks,
  sortDoneTasks,
  sortTasks,
  TASK_BUCKET_LABELS,
  type TaskBucketKey,
  type TaskSort,
} from "@/services/notion/task-buckets";
import type { TagCatalog } from "@/services/notion/tag-options";
import type { PlaceCatalog } from "@/services/notion/places";
import type { TaskItem, WritableCalendar } from "@/types/calendar";
import { dateKeyPlusMinutes } from "@/components/calendar/datetime-fields";

const ORDER: TaskBucketKey[] = ["overdue", "today", "upcoming", "someday", "done"];

const DEFAULT_START_MINUTES = 9 * 60;
const DEFAULT_TASK_DUE_MINUTES = 18 * 60;

export function TaskList({
  tasks,
  tagCatalog,
  timeZone,
  loadError,
  calendars = [],
  placeCatalog = { ready: false, places: [] },
  weekStartsOn = 0,
}: {
  tasks: TaskItem[];
  /** 登録済みのタグ・種類。色の表示と入力の候補に使う。 */
  tagCatalog: TagCatalog;
  timeZone: string;
  loadError: string | null;
  calendars?: WritableCalendar[];
  placeCatalog?: PlaceCatalog;
  weekStartsOn?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sort, setSort] = useState<TaskSort>("due");
  const [itemDialog, setItemDialog] = useState<ItemDrafts | null>(null);
  // タップした直後は表示専用画面を開く。編集アイコンを押したときだけ draft へ切り替える。
  const [viewingTask, setViewingTask] = useState<TaskItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // オフライン中は書き込みを止める（docs/spec.md §21）。
  const offline = useOffline();
  useReconnectRefresh();

  const utils = useMemo(() => createCalendarDateUtils(timeZone), [timeZone]);
  const buckets = useMemo(
    () => classifyTasks(tasks, utils.todayKey(), utils.itemDateKey),
    [tasks, utils],
  );

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

  const openAdd = () => {
    const utils = createCalendarDateUtils(timeZone);
    const defaultDayKey = utils.todayKey();
    const drafts: ItemDrafts = {};
    drafts.task = {
      dueMode: "datetime",
      due: dateKeyPlusMinutes(defaultDayKey, DEFAULT_TASK_DUE_MINUTES),
    };
    if (calendars.length > 0) {
      drafts.event = {
        allDay: false,
        start: dateKeyPlusMinutes(defaultDayKey, DEFAULT_START_MINUTES),
        end: dateKeyPlusMinutes(defaultDayKey, Math.min(DEFAULT_START_MINUTES + 60, 23 * 60 + 30)),
      };
    }
    drafts.reminder = { dateMode: "date", date: defaultDayKey };
    setItemDialog(drafts);
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-2 bg-surface-container-low px-2 py-2">
        <div className="flex shrink-0 items-center gap-1 font-semibold">
          <ListChecks className="size-5" />
          <span className="hidden lg:inline">DaySpan</span>
        </div>

        <HeaderNav current="tasks" />

        <span className="flex-1" />

        <Button
          variant="outline"
          size="sm"
          onClick={() => setSort(sort === "due" ? "priority" : "due")}
        >
          <ArrowUpDown className="size-4" />
          {sort === "due" ? "期限順" : "優先度順"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
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
        {ORDER.map((key) => {
          const items =
            key === "done" ? sortDoneTasks(buckets[key]) : sortTasks(buckets[key], sort);
          if (items.length === 0) return null;

          return (
            <section key={key}>
              <h2 className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-rule bg-background/95 px-3 py-1.5 text-[11px] tracking-widest text-muted-foreground backdrop-blur">
                {TASK_BUCKET_LABELS[key]}
                <span className="text-[10px] opacity-70">{items.length}</span>
              </h2>

              <ul>
                {items.map((task) => (
                  <li key={task.id} className="flex items-start gap-3 px-4 py-3">
                    <Checkbox
                      className="mt-0.5"
                      checked={task.done}
                      disabled={busyId === task.id || offline}
                      aria-label={`${task.title} を完了にする`}
                      onCheckedChange={(value) => toggleDone(task, value === true)}
                    />

                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setViewingTask(task)}
                    >
                      <div
                        className={cn(
                          "type-body-large clip-nowrap",
                          task.done && "text-on-surface-variant line-through",
                        )}
                      >
                        {task.title}
                      </div>

                      <div className="type-body-small flex flex-wrap items-center gap-1.5 text-on-surface-variant">
                        {task.due && (
                          <span className={cn(key === "overdue" && "text-destructive")}>
                            {formatTaskDate(task.due, task.hasTime, utils)}
                          </span>
                        )}
                        {/* 予定日は期限とは別の日付。分類・並び順は期限のままで、見えるだけ添える。 */}
                        {task.planned && (
                          <span className="opacity-80">
                            予定 {formatTaskDate(task.planned, task.plannedHasTime, utils)}
                          </span>
                        )}
                        {task.priority && (
                          <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                            {task.priority}
                          </Badge>
                        )}
                        {task.recurrence && task.recurrence !== "なし" && (
                          <span className="opacity-80">{task.recurrence}</span>
                        )}
                        <TagChipList names={task.tags} options={tagCatalog.task ?? []} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {tasks.length === 0 && !loadError && (
          <p className="p-6 text-center text-sm text-muted-foreground">タスクがありません。</p>
        )}
      </div>

      <Button
        size="icon"
        className="elevation-3 fixed right-4 bottom-[calc(6rem_+_env(safe-area-inset-bottom))] size-14 rounded-lg bg-primary-container text-on-primary-container hover:brightness-95 md:bottom-6"
        aria-label="タスクを追加"
        disabled={offline}
        onClick={openAdd}
      >
        <Plus className="size-6" />
      </Button>

      <BottomNav current="tasks" />

      {itemDialog && (
        <ItemDialog
          initialKind={
            itemDialog.event ? "event" : itemDialog.task ? "task" : "reminder"
          }
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

function formatTaskDate(
  date: string,
  hasTime: boolean,
  utils: ReturnType<typeof createCalendarDateUtils>,
): string {
  const dateKey = utils.itemDateKey(date);
  const label = `${dateKey.slice(0, 4)}/${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`;

  return hasTime ? `${label} ${utils.formatTime(date)}` : label;
}
