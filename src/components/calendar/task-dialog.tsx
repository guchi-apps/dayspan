"use client";

import { useState } from "react";

import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RECURRENCE_PRESETS } from "@/services/notion/recurrence";
import type { TaskItem } from "@/types/calendar";

import { isoToLocalInput, localInputToIso } from "./datetime-fields";
import type { TouchedRange } from "./use-calendar-chunks";

const PRIORITY_OPTIONS = ["高", "中", "低"];
const NO_VALUE = "__none__";

/** 期限の指定方法（docs/spec.md §15）。 */
type DueMode = "datetime" | "date" | "none";

export type TaskDraft = {
  task?: TaskItem;
  dueMode: DueMode;
  /** dueMode に応じて YYYY-MM-DD または YYYY-MM-DDTHH:mm */
  due: string;
};

export function TaskDialog({
  draft,
  timeZone,
  onClose,
  onSaved,
}: {
  draft: TaskDraft;
  timeZone: string;
  onClose: () => void;
  /** 保存後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  onSaved: (touched: TouchedRange[] | null) => void;
}) {
  const editing = draft.task;

  const [title, setTitle] = useState(editing?.title ?? "");
  const [dueMode, setDueMode] = useState<DueMode>(draft.dueMode);
  const [due, setDue] = useState(draft.due);
  const [done, setDone] = useState(editing?.done ?? false);
  const [priority, setPriority] = useState(editing?.priority ?? NO_VALUE);
  const [memo, setMemo] = useState(editing?.memo ?? "");
  const [tags, setTags] = useState((editing?.tags ?? []).join(", "));
  const [recurrence, setRecurrence] = useState(editing?.recurrence ?? "なし");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) close();
  };

  const finish = (touched: TouchedRange[] | null) => {
    setOpen(false);
    setTimeout(() => onSaved(touched), 150);
  };

  const changeDueMode = (next: DueMode) => {
    if (next === "datetime" && !due.includes("T")) setDue(`${due.slice(0, 10)}T18:00`);
    if (next === "date" && due.includes("T")) setDue(due.slice(0, 10));
    setDueMode(next);
  };

  const buildDue = (): string | null => {
    if (dueMode === "none") return null;
    if (dueMode === "date") return due.slice(0, 10);
    return localInputToIso(due, timeZone);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title,
        due: buildDue(),
        done,
        priority: priority === NO_VALUE ? null : priority,
        memo: memo.trim() || null,
        tags: tags
          .split(/[,、]/)
          .map((value) => value.trim())
          .filter(Boolean),
        recurrence,
      };

      const response = await fetch(
        editing ? `/api/tasks/${encodeURIComponent(editing.id)}` : "/api/tasks",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        setError(await readErrorMessage(response, "保存できませんでした。"));
        return;
      }

      // 期限を動かした場合は移動元も変わる。期限なしはカレンダーに出ないため対象から外す。
      const touched: TouchedRange[] = [];
      if (payload.due) touched.push({ start: payload.due, end: payload.due });
      if (editing?.due) touched.push({ start: editing.due, end: editing.due });

      finish(touched);
    } catch (cause) {
      // 日時の変換など、リクエスト送信前に失敗することもある。黙って閉じないよう画面に出す。
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "タスクを編集" : "タスクを追加"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            id="task-title"
            label="タイトル"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />

          <div className="flex flex-col gap-1.5">
            <Label>期限</Label>
            <div className="flex gap-1">
              {(
                [
                  ["datetime", "日時指定"],
                  ["date", "日付のみ"],
                  ["none", "未設定"],
                ] as const
              ).map(([mode, label]) => (
                <Button
                  key={mode}
                  type="button"
                  variant={dueMode === mode ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => changeDueMode(mode)}
                >
                  {label}
                </Button>
              ))}
            </div>
            {dueMode !== "none" && (
              <Input
                type={dueMode === "datetime" ? "datetime-local" : "date"}
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label>優先度</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue placeholder="未設定" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VALUE}>未設定</SelectItem>
                  {PRIORITY_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>繰り返し</Label>
              <Select value={recurrence} onValueChange={setRecurrence}>
                <SelectTrigger>
                  <SelectValue placeholder="なし" />
                </SelectTrigger>
                <SelectContent>
                  {RECURRENCE_PRESETS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                  {/* 曜日指定はNotion側で「毎週(月・水・金)」の形で保存されている。
                      既存の値をそのまま選び直せるよう、選択肢に足しておく。 */}
                  {editing?.recurrence &&
                    !RECURRENCE_PRESETS.includes(editing.recurrence) && (
                      <SelectItem value={editing.recurrence}>{editing.recurrence}</SelectItem>
                    )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Input
            id="task-tags"
            label="タグ"
            placeholder="カンマ区切り"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-memo">メモ</Label>
            <Textarea
              id="task-memo"
              rows={3}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={done} onCheckedChange={(v) => setDone(v === true)} />
            完了
          </label>

          {editing?.url && (
            <a
              href={editing.url}
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
          <Button variant="ghost" disabled={busy} onClick={close}>
            やめる
          </Button>
          <Button disabled={busy || !title.trim()} onClick={save}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function toTaskDraft(task: TaskItem, timeZone: string): TaskDraft {
  if (!task.due) return { task, dueMode: "none", due: "" };
  if (!task.hasTime) return { task, dueMode: "date", due: task.due };
  return { task, dueMode: "datetime", due: isoToLocalInput(task.due, timeZone) };
}

/** サーバーが返した失敗理由を取り出す。無い場合は既定の文言にする。 */
async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? fallback;
  } catch {
    return fallback;
  }
}
