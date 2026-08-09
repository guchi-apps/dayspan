"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, ListChecks, Plus, RefreshCw } from "lucide-react";

import { BottomNav, HeaderNav } from "@/components/nav/main-nav";
import { LinearProgress } from "@/components/ui/linear-progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { TaskDetailDialog } from "@/components/calendar/task-detail-dialog";
import { TaskDialog, toTaskDraft, type TaskDraft } from "@/components/calendar/task-dialog";
import { cn } from "@/lib/utils";
import {
  classifyTasks,
  sortDoneTasks,
  sortTasks,
  TASK_BUCKET_LABELS,
  type TaskBucketKey,
  type TaskSort,
} from "@/services/notion/task-buckets";
import type { TaskItem } from "@/types/calendar";

const ORDER: TaskBucketKey[] = ["overdue", "today", "upcoming", "someday", "done"];

export function TaskList({
  tasks,
  timeZone,
  loadError,
}: {
  tasks: TaskItem[];
  timeZone: string;
  loadError: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sort, setSort] = useState<TaskSort>("due");
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  // タップした直後は表示専用画面を開く。編集アイコンを押したときだけ draft へ切り替える。
  const [viewingTask, setViewingTask] = useState<TaskItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const utils = useMemo(() => createCalendarDateUtils(timeZone), [timeZone]);
  const buckets = useMemo(
    () => classifyTasks(tasks, utils.todayKey(), utils.itemDateKey),
    [tasks, utils],
  );

  const patchTaskDone = async (task: TaskItem, done: boolean) => {
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
    setViewingTask(null);
    setDraft(toTaskDraft(task, timeZone));
  };

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-2 bg-surface-container-low px-2 py-2">
        <h1 className="type-title-large flex items-center gap-2 px-2">
          <ListChecks className="size-5" />
          <span className="hidden sm:inline">タスク</span>
        </h1>

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
          disabled={pending}
          onClick={() => startTransition(() => router.refresh())}
        >
          <RefreshCw className="size-4" />
        </Button>
      </header>

      <LinearProgress active={pending || busyId !== null} />

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
                      disabled={busyId === task.id}
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
                            {formatDue(task, utils)}
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
                        {task.tags.map((tag) => (
                          <span key={tag} className="rounded bg-muted px-1">
                            {tag}
                          </span>
                        ))}
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
        onClick={() =>
          setDraft({ dueMode: "date", due: utils.todayKey() })
        }
      >
        <Plus className="size-6" />
      </Button>

      <BottomNav current="tasks" />

      {draft && (
        <TaskDialog
          draft={draft}
          timeZone={timeZone}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            startTransition(() => router.refresh());
          }}
        />
      )}

      {viewingTask && (
        <TaskDetailDialog
          task={viewingTask}
          timeZone={timeZone}
          onClose={() => setViewingTask(null)}
          onEdit={() => editTask(viewingTask)}
          onToggleDone={toggleDoneFromDetail}
        />
      )}
    </div>
  );
}

function formatDue(task: TaskItem, utils: ReturnType<typeof createCalendarDateUtils>): string {
  if (!task.due) return "";

  const dateKey = utils.itemDateKey(task.due);
  const label = `${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`;

  return task.hasTime ? `${label} ${utils.formatTime(task.due)}` : label;
}
