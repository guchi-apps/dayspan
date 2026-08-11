"use client";

import { useOffline } from "next/offline";
import { useState } from "react";

import { ExternalLink, Trash2 } from "lucide-react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagPicker } from "@/components/tags/tag-picker";
import { Textarea } from "@/components/ui/textarea";
import { RECURRENCE_PRESETS } from "@/services/notion/recurrence";
import type { TagOption } from "@/services/notion/tag-options";
import type { TaskItem } from "@/types/calendar";

import { DateTimeInput } from "./date-time-input";
import { DeleteItemDialog } from "./delete-item-dialog";
import { isoToLocalInput, localInputToIso } from "./datetime-fields";
import { readErrorMessage } from "./response-error";
import { taskRanges, type TouchedRange } from "./use-calendar-chunks";

const PRIORITY_OPTIONS = ["高", "中", "低"];
const NO_VALUE = "__none__";

/** 期限・予定日の指定方法（docs/spec.md §15）。 */
type DueMode = "datetime" | "date" | "none";

const DATE_MODES: [DueMode, string][] = [
  ["datetime", "日時指定"],
  ["date", "日付のみ"],
  ["none", "未設定"],
];

// 日時指定へ切り替えたときの初期時刻。期限はその日のうちに片付ける想定の時刻、
// 予定日は取りかかる時間帯として朝から始める。
const DEFAULT_DUE_TIME = "18:00";
const DEFAULT_PLANNED_TIME = "09:00";

export type TaskDraft = {
  task?: TaskItem;
  dueMode: DueMode;
  /** dueMode に応じて YYYY-MM-DD または YYYY-MM-DDTHH:mm */
  due: string;
  /** 予定日の指定方法。追加のときは省略してよい（未設定から始める）。 */
  plannedMode?: DueMode;
  planned?: string;
};

/**
 * タスクの入力欄。ダイアログの枠と種類の切り替えは ItemDialog が持つ。
 * 開閉のアニメーションもそちらが持つため、ここでは保存できたことだけを伝える。
 */
export function TaskForm({
  draft,
  timeZone,
  tagOptions,
  title,
  autoFocusTitle,
  onTitleChange,
  onCancel,
  onSaved,
}: {
  draft: TaskDraft;
  timeZone: string;
  /** 設定画面で登録済みのタグ。無い名前もここから足せる（Notionが選択肢を増やす）。 */
  tagOptions: TagOption[];
  /** タイトルは種類を切り替えても引き継ぐため、ItemDialog が持つ。 */
  title: string;
  autoFocusTitle: boolean;
  onTitleChange: (value: string) => void;
  onCancel: () => void;
  /** 保存後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  onSaved: (touched: TouchedRange[] | null) => void;
}) {
  const editing = draft.task;

  const [dueMode, setDueMode] = useState<DueMode>(draft.dueMode);
  const [due, setDue] = useState(draft.due);
  // 予定日は必須ではないため、追加のときは未設定から始める。
  const [plannedMode, setPlannedMode] = useState<DueMode>(draft.plannedMode ?? "none");
  const [planned, setPlanned] = useState(draft.planned ?? "");
  const [done, setDone] = useState(editing?.done ?? false);
  const [priority, setPriority] = useState(editing?.priority ?? NO_VALUE);
  const [memo, setMemo] = useState(editing?.memo ?? "");
  const [tags, setTags] = useState<string[]>(editing?.tags ?? []);
  const [recurrence, setRecurrence] = useState(editing?.recurrence ?? "なし");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 削除は押した直後には実行せず、確認を挟む。
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 開いている途中で通信が落ちることがある（docs/spec.md §21）。
  const offline = useOffline();

  // 日付を選ぶモードなのに空欄のままだと、保存時の日時変換で失敗する。先に画面で知らせる。
  const missingDateError = (label: string, mode: DueMode, value: string): string | null => {
    if (mode === "none" || value) return null;
    return mode === "datetime"
      ? `${label}の日付と時刻を入力してください。`
      : `${label}の日付を入力してください。`;
  };

  const dueError = missingDateError("期限", dueMode, due);
  const plannedError = missingDateError("予定日", plannedMode, planned);

  const buildDate = (mode: DueMode, value: string): string | null => {
    if (mode === "none") return null;
    if (mode === "date") return value.slice(0, 10);
    return localInputToIso(value, timeZone);
  };

  const save = async () => {
    // 開いている最中に通信が落ちることもある。押せない状態にするだけでなく、ここでも断つ。
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const payload = {
        title,
        due: buildDate(dueMode, due),
        planned: buildDate(plannedMode, planned),
        done,
        priority: priority === NO_VALUE ? null : priority,
        memo: memo.trim() || null,
        tags,
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

      // 期限・予定日を動かした場合は移動元も変わる。どちらも未設定の状態は
      // カレンダーに出ないため、対象から外れる。
      const touched: TouchedRange[] = [
        ...taskRanges(payload),
        ...(editing ? taskRanges(editing) : []),
      ];

      onSaved(touched);
    } catch (cause) {
      // 日時の変換など、リクエスト送信前に失敗することもある。黙って閉じないよう画面に出す。
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {editing && confirmingDelete && (
        <DeleteItemDialog
          item={{ kind: "task", task: editing }}
          onCancel={() => setConfirmingDelete(false)}
          onDeleted={onSaved}
        />
      )}

      <div className="flex min-w-0 flex-col gap-4">
        <Input
          id="task-title"
          label="タイトル"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          autoFocus={autoFocusTitle}
        />

        <DateModeField
          id="task-due"
          label="期限"
          mode={dueMode}
          value={due}
          timeZone={timeZone}
          defaultTime={DEFAULT_DUE_TIME}
          onChange={(next) => {
            setDueMode(next.mode);
            setDue(next.value);
          }}
        />

        {/* 予定日は期限までのどの辺りで片付けるかの見込み。締切とは別に持つ（docs/spec.md §9）。 */}
        <DateModeField
          id="task-planned"
          label="予定日"
          mode={plannedMode}
          value={planned}
          timeZone={timeZone}
          defaultTime={DEFAULT_PLANNED_TIME}
          onChange={(next) => {
            setPlannedMode(next.mode);
            setPlanned(next.value);
          }}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-2">
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger label="優先度">
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

          <Select value={recurrence} onValueChange={setRecurrence}>
            <SelectTrigger label="繰り返し">
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

        <TagPicker label="タグ" options={tagOptions} value={tags} multiple onChange={setTags} />

        <Textarea
          id="task-memo"
          label="メモ"
          rows={3}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />

        <label className="-my-1 flex min-h-11 items-center gap-3 px-4 text-base select-none md:text-sm">
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

        {dueError && <p className="text-sm text-destructive">{dueError}</p>}
        {plannedError && <p className="text-sm text-destructive">{plannedError}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter className="sm:justify-between">
        {editing ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || offline}
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="size-4" />
            削除
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            やめる
          </Button>
          <Button
            disabled={
              busy || offline || !title.trim() || dueError !== null || plannedError !== null
            }
            onClick={save}
          >
            保存
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

/**
 * 期限・予定日の入力欄。指定方法（日時／日付のみ／未設定）と入力欄を組で出す。
 * 2つの日付で形を揃えるため、1つの部品にまとめる。
 */
function DateModeField({
  id,
  label,
  mode,
  value,
  timeZone,
  defaultTime,
  onChange,
}: {
  id: string;
  label: string;
  mode: DueMode;
  /** mode に応じて YYYY-MM-DD または YYYY-MM-DDTHH:mm */
  value: string;
  timeZone: string;
  /** 日時指定へ切り替えたときの初期時刻（HH:mm）。 */
  defaultTime: string;
  onChange: (next: { mode: DueMode; value: string }) => void;
}) {
  const changeMode = (next: DueMode) => {
    if (next === "none") {
      onChange({ mode: next, value });
      return;
    }

    // 未設定から切り替えた直後は日付を持っていない。設定タイムゾーンでの今日を入れる。
    // 実行環境のローカル時刻ではなく設定タイムゾーンで求めるのは、他の日時と揃えるため。
    const date =
      value.slice(0, 10) || isoToLocalInput(new Date().toISOString(), timeZone).slice(0, 10);

    onChange({
      mode: next,
      value: next === "datetime" ? `${date}T${value.slice(11, 16) || defaultTime}` : date,
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-1">
        {DATE_MODES.map(([option, optionLabel]) => (
          <Button
            key={option}
            type="button"
            variant={mode === option ? "secondary" : "outline"}
            size="sm"
            onClick={() => changeMode(option)}
          >
            {optionLabel}
          </Button>
        ))}
      </div>
      {mode === "datetime" && (
        <DateTimeInput
          id={id}
          dateLabel={`${label}の日付`}
          timeLabel={`${label}の時刻`}
          value={value}
          onChange={(next) => onChange({ mode, value: next })}
        />
      )}
      {mode === "date" && (
        <Input
          id={`${id}-date`}
          label={`${label}の日付`}
          type="date"
          value={value}
          onChange={(e) => onChange({ mode, value: e.target.value })}
        />
      )}
    </div>
  );
}

export function toTaskDraft(task: TaskItem, timeZone: string): TaskDraft {
  const field = (date: string | null, hasTime: boolean) => {
    if (!date) return { mode: "none" as DueMode, value: "" };
    if (!hasTime) return { mode: "date" as DueMode, value: date };
    return { mode: "datetime" as DueMode, value: isoToLocalInput(date, timeZone) };
  };

  const due = field(task.due, task.hasTime);
  const planned = field(task.planned, task.plannedHasTime);

  return {
    task,
    dueMode: due.mode,
    due: due.value,
    plannedMode: planned.mode,
    planned: planned.value,
  };
}
