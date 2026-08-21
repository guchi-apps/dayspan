"use client";

import { useEffect, useMemo, useState } from "react";

import { useOffline } from "next/offline";
import { Plus } from "lucide-react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { resolveStageDate } from "@/services/task-links/stage";
import type { CalendarEventItem, TaskEventStage, TaskItem } from "@/types/calendar";

import { formatLinkedDate } from "./task-link-label";
import { TaskStagePicker } from "./task-stage-picker";
import { readErrorMessage } from "./response-error";
import { taskRanges, type TouchedRange } from "./use-calendar-chunks";

/**
 * 予定にタスクを紐づける（docs/spec.md §31）。
 *
 * 選ぶ相手は「カレンダーに出ているタスク」では足りない。期限も予定日も無いタスクは
 * カレンダーに置く日が決まらず表示されていないが（docs/spec.md §10）、それこそが
 * 「いつやるか決まっていない」＝紐づけたいタスクであるため、ここで別に取りにいく。
 */
export function TaskLinkDialog({
  event,
  timeZone,
  onCancel,
  onCreateTask,
  onLinked,
}: {
  event: CalendarEventItem;
  timeZone: string;
  onCancel: () => void;
  /** 紐づけた状態で新しいタスクを作る。入力画面へ渡す。 */
  onCreateTask: (stage: TaskEventStage) => void;
  /** 紐づけ後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  onLinked: (touched: TouchedRange[] | null) => void;
}) {
  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
  const [stage, setStage] = useState<TaskEventStage>("BEFORE_START");
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offline = useOffline();

  useEffect(() => {
    let cancelled = false;

    // 未完了のタスクを取りにいく。紐づけ先を選ぶときだけの取得で、カレンダーの取得には混ぜない
    // （月を送るたびにNotionへの往復が増えるため。タグの取得を分けているのと同じ理由）。
    fetch("/api/tasks")
      .then(async (response) => {
        if (!response.ok) throw new Error(await readErrorMessage(response, "タスクを取得できませんでした。"));
        return (await response.json()) as { tasks: TaskItem[] };
      })
      .then((data) => {
        if (!cancelled) setTasks(data.tasks);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setTasks([]);
        setError(cause instanceof Error ? cause.message : "タスクを取得できませんでした。");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const close = () => {
    setOpen(false);
    setTimeout(onCancel, 150);
  };

  const resolved = resolveStageDate(event, stage);

  const filtered = useMemo(() => {
    if (!tasks) return [];
    const keyword = query.trim();
    if (!keyword) return tasks;
    return tasks.filter((task) => task.title.includes(keyword));
  }, [tasks, query]);

  const selected = tasks?.find((task) => task.id === selectedId) ?? null;

  const link = async () => {
    if (!selected) return;

    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/task-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: selected.id,
          calendarId: event.calendarId,
          eventId: event.id,
          stage,
        }),
      });

      if (!response.ok) {
        setError(await readErrorMessage(response, "紐づけできませんでした。"));
        return;
      }

      const result = (await response.json()) as { planned?: string };

      // 予定日が動くため、移動元と移動先の両方を取り直す。
      const touched: TouchedRange[] = [
        ...taskRanges(selected),
        ...taskRanges({ due: selected.due, planned: result.planned ?? resolved.date }),
      ];

      setOpen(false);
      setTimeout(() => onLinked(touched), 150);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "紐づけできませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const createTask = () => {
    setOpen(false);
    setTimeout(() => onCreateTask(stage), 150);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>「{event.title}」に紐づける</DialogTitle>
          <DialogDescription className="type-body-small text-on-surface-variant">
            選んだ段階から決まる日時が、タスクの予定日に入ります。予定を動かすと予定日も動きます。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <TaskStagePicker value={stage} onChange={setStage} />

          <div className="flex flex-col gap-1.5">
            <Label>タスク</Label>
            <Input
              id="task-link-search"
              label="タスクを探す"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />

            <div className="max-h-56 overflow-y-auto rounded-md border border-outline-variant">
              {tasks === null && (
                <p className="px-3 py-4 text-sm text-muted-foreground">読み込んでいます…</p>
              )}
              {tasks !== null && filtered.length === 0 && (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  {tasks.length === 0
                    ? "未完了のタスクがありません。新しいタスクを作ってください。"
                    : "見つかりませんでした。"}
                </p>
              )}
              {filtered.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setSelectedId(task.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 border-b border-outline-variant px-3 py-2 text-left text-sm last:border-b-0",
                    task.id === selectedId
                      ? "bg-secondary-container text-on-secondary-container font-medium"
                      : "hover:bg-surface-container-high",
                  )}
                >
                  <span className="clip-nowrap">{task.title}</span>
                  {/*
                    すでに別の予定へ紐づいているタスクは、選ぶとその紐づけが置き換わる
                    （紐づけはタスクにつき1件）。選ぶ前に分かるようにする。
                  */}
                  <span className="shrink-0 text-xs opacity-70">
                    {task.link
                      ? `${task.link.eventTitle} に紐づけ済み`
                      : task.due
                        ? formatLinkedDate(task.due, timeZone)
                        : "期限なし"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-sm text-on-surface-variant">
            予定日は <b>{formatLinkedDate(resolved.date, timeZone)}</b> になります。
            {selected?.link
              ? `「${selected.link.eventTitle}」への紐づけは外れます。`
              : selected?.planned
                ? "すでに入っている予定日は上書きされます。"
                : null}
          </p>

          {offline && <p className="text-xs text-on-surface-variant">{OFFLINE_WRITE_MESSAGE}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" disabled={busy || offline} onClick={createTask}>
            <Plus className="size-4" />
            新しいタスクを作る
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={close}>
              やめる
            </Button>
            <Button disabled={busy || offline || !selected} onClick={link}>
              紐づける
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
