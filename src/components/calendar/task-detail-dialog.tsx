"use client";

import { useState, type ReactNode } from "react";

import { AlertTriangle, ExternalLink, Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { TagChipList } from "@/components/tags/tag-chip";
import { cn } from "@/lib/utils";
import type { TagOption } from "@/services/notion/tag-options";
import type { TaskEventStage, TaskItem } from "@/types/calendar";

import { DeleteItemDialog } from "./delete-item-dialog";
import { formatLinkedDate, taskLinkFullLabel, taskLinkStageLabel } from "./task-link-label";
import { TaskStageMark } from "./task-stage-mark";
import { TaskStagePicker } from "./task-stage-picker";
import { readErrorMessage } from "./response-error";
import { taskRanges, type TouchedRange } from "./use-calendar-chunks";

export function TaskDetailDialog({
  task,
  tagOptions,
  timeZone,
  readOnly = false,
  onClose,
  onEdit,
  onDeleted,
  onToggleDone,
  onChanged,
}: {
  task: TaskItem;
  /** 登録済みのタグ。色を引くために渡す。取得できていないときは空でよい。 */
  tagOptions: TagOption[];
  timeZone: string;
  /** 閲覧のみにする。オフライン中に使う（docs/spec.md §21）。 */
  readOnly?: boolean;
  onClose: () => void;
  onEdit: () => void;
  /** 削除後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  onDeleted: (touched: TouchedRange[] | null) => void;
  /** 完了状態の切り替え。表示画面のままでも設定できるようにするため、保存とは別経路で呼ぶ。 */
  onToggleDone: (task: TaskItem, done: boolean) => Promise<void>;
  /** 画面を開いたまま内容が変わったときの通知（紐づけの操作）。変わった期間だけ取り直す。 */
  onChanged: (touched: TouchedRange[] | null) => void;
}) {
  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
  const [done, setDone] = useState(task.done);
  // 予定への紐づけ（docs/spec.md §31）。段階の変更・ずれの解消・解除はこの画面で行う。
  // 保存を挟まずその場で効かせるのは、完了の切り替えと同じく、押した結果が予定日という
  // 別の項目に現れるため。編集画面まで往復させると何が変わったのか追いにくい。
  const [link, setLink] = useState(task.link);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 削除は押した直後には実行せず、確認を挟む。
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) close();
  };

  const edit = () => {
    setOpen(false);
    setTimeout(onEdit, 150);
  };

  const deleted = (touched: TouchedRange[] | null) => {
    setOpen(false);
    setTimeout(() => onDeleted(touched), 150);
  };

  /** 段階の変更と「予定に合わせる」。どちらも予定から日時を決め直して予定日へ入れる。 */
  const resyncLink = async (stage?: TaskEventStage) => {
    if (!link) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/task-links/${encodeURIComponent(link.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stage ? { stage } : {}),
      });

      if (!response.ok) {
        setError(await readErrorMessage(response, "予定に合わせられませんでした。"));
        return;
      }

      const result = (await response.json()) as { planned?: string };
      const planned = result.planned ?? link.resolvedAt;

      setLink({
        ...link,
        stage: stage ?? link.stage,
        resolvedAt: planned,
        resolvedAllDay: !planned.includes("T"),
        drifted: false,
        expectedAt: null,
      });

      // 予定日が動いたため、移動元と移動先の両方を取り直す。閉じずに続けて操作できるよう、
      // 画面はそのままにする。
      onChanged([...taskRanges(task), { start: planned, end: planned }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "予定に合わせられませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!link) return;

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/task-links/${encodeURIComponent(link.id)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "紐づけを解除できませんでした。"));
        return;
      }
      setLink(null);
      onChanged(taskRanges(task));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "紐づけを解除できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const toggleDone = async (value: boolean) => {
    setDone(value);
    setBusy(true);
    setError(null);
    try {
      await onToggleDone(task, value);
    } catch (cause) {
      setDone(!value);
      setError(cause instanceof Error ? cause.message : "更新できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {confirmingDelete && (
          <DeleteItemDialog
            item={{ kind: "task", task }}
            onCancel={() => setConfirmingDelete(false)}
            onDeleted={deleted}
          />
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="削除"
          className="absolute top-2 right-18"
          disabled={readOnly}
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="編集"
          className="absolute top-2 right-10"
          disabled={readOnly}
          onClick={edit}
        >
          <Pencil className="size-4" />
        </Button>

        <DialogHeader>
          <DialogTitle className={cn("pr-22", done && "text-on-surface-variant line-through")}>
            {task.title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm">
          <label className="-my-1 flex min-h-11 items-center gap-3 px-4 text-base select-none md:text-sm">
            <Checkbox
              checked={done}
              disabled={busy || readOnly}
              onCheckedChange={(v) => toggleDone(v === true)}
            />
            完了
          </label>

          {readOnly && <p className="px-4 text-xs text-on-surface-variant">{OFFLINE_WRITE_MESSAGE}</p>}

          {task.due && (
            <DetailField label="期限" value={formatTaskDate(task.due, task.hasTime, timeZone)} />
          )}
          {task.planned && (
            <DetailField
              label="予定日"
              value={
                link
                  ? `${formatTaskDate(task.planned, task.plannedHasTime, timeZone)}（予定に合わせて入る）`
                  : formatTaskDate(task.planned, task.plannedHasTime, timeZone)
              }
            />
          )}
          {link && (
            <div className="flex flex-col gap-2 px-4">
              <span className="text-xs text-muted-foreground">予定に合わせる</span>

              <span className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-secondary-container px-2.5 py-1 text-on-secondary-container">
                <TaskStageMark
                  stage={link.stage}
                  className="h-3.5 w-4.5 text-on-secondary-container"
                />
                {taskLinkFullLabel(link)}
              </span>

              {/*
                DaySpanの外で予定が動いた場合は、取得のたびにNotionへ書き戻さず画面に出す
                （docs/spec.md §20・§31）。押されたときだけ合わせる。
              */}
              {link.drifted && link.expectedAt && (
                <div className="flex flex-col gap-2 rounded-lg bg-error-container px-3 py-2 text-on-error-container">
                  <span className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    予定日が紐づけ先と合っていません。「{link.eventTitle}」の
                    {taskLinkStageLabel(link)}は {formatLinkedDate(link.expectedAt, timeZone)} です。
                  </span>
                  <Button
                    size="sm"
                    className="w-fit"
                    disabled={busy || readOnly}
                    onClick={() => resyncLink()}
                  >
                    予定に合わせる
                  </Button>
                </div>
              )}

              <TaskStagePicker
                value={link.stage}
                label="いつやるか"
                disabled={busy || readOnly}
                onChange={(stage) => resyncLink(stage)}
              />

              <Button variant="ghost" size="sm" className="w-fit" disabled={busy || readOnly} onClick={unlink}>
                紐づけを解除
              </Button>
            </div>
          )}

          {task.priority && <DetailField label="優先度" value={task.priority} />}
          {task.recurrence && task.recurrence !== "なし" && (
            <DetailField label="繰り返し" value={task.recurrence} />
          )}
          {task.tags.length > 0 && (
            <DetailField label="タグ">
              <TagChipList names={task.tags} options={tagOptions} />
            </DetailField>
          )}
          {task.memo && <DetailField label="メモ" value={task.memo} />}

          {task.url && (
            <a
              href={task.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              <ExternalLink className="size-3" />
              Notionで開く
            </a>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            閉じる
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 見出しと中身の組。文字だけの項目は value、チップのように形のある項目は children で渡す。 */
function DetailField({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 px-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children ?? <span className="whitespace-pre-wrap">{value}</span>}
    </div>
  );
}

/** 期限・予定日の表示用フォーマット。日付のみは日付を、時刻ありは日付と時刻を表示する。 */
function formatTaskDate(date: string, hasTime: boolean, timeZone: string): string {
  if (!hasTime) return formatDateKey(date);

  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(date));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("month")}月${get("day")}日 ${get("hour")}:${get("minute")}`;
}

function formatDateKey(dateKey: string): string {
  return `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`;
}
