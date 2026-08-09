"use client";

import { useState } from "react";

import { ExternalLink, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { TaskItem } from "@/types/calendar";

export function TaskDetailDialog({
  task,
  timeZone,
  onClose,
  onEdit,
  onToggleDone,
}: {
  task: TaskItem;
  timeZone: string;
  onClose: () => void;
  onEdit: () => void;
  /** 完了状態の切り替え。表示画面のままでも設定できるようにするため、保存とは別経路で呼ぶ。 */
  onToggleDone: (task: TaskItem, done: boolean) => Promise<void>;
}) {
  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
  const [done, setDone] = useState(task.done);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="編集"
          className="absolute top-2 right-10"
          onClick={edit}
        >
          <Pencil className="size-4" />
        </Button>

        <DialogHeader>
          <DialogTitle className={cn("pr-14", done && "text-on-surface-variant line-through")}>
            {task.title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm">
          <label className="-my-1 flex min-h-11 items-center gap-3 px-4 text-base select-none md:text-sm">
            <Checkbox checked={done} disabled={busy} onCheckedChange={(v) => toggleDone(v === true)} />
            完了
          </label>

          {task.due && <DetailField label="期限" value={formatDue(task, timeZone)} />}
          {task.priority && <DetailField label="優先度" value={task.priority} />}
          {task.recurrence && task.recurrence !== "なし" && (
            <DetailField label="繰り返し" value={task.recurrence} />
          )}
          {task.tags.length > 0 && <DetailField label="タグ" value={task.tags.join(", ")} />}
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

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap">{value}</span>
    </div>
  );
}

/** 期限の表示用フォーマット。日付のみは日付を、時刻ありは日付と時刻を表示する。 */
function formatDue(task: TaskItem, timeZone: string): string {
  if (!task.due) return "";
  if (!task.hasTime) return formatDateKey(task.due);

  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(task.due));

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("month")}月${get("day")}日 ${get("hour")}:${get("minute")}`;
}

function formatDateKey(dateKey: string): string {
  return `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`;
}
