"use client";

import { useOffline } from "next/offline";
import { useState } from "react";

import { ExternalLink, Trash2 } from "lucide-react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogFooter } from "@/components/ui/dialog";
import { TagPicker } from "@/components/tags/tag-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { TagOption } from "@/services/notion/tag-options";
import type { ReminderItem } from "@/types/calendar";

import { DateTimeInput } from "./date-time-input";
import { DeleteItemDialog } from "./delete-item-dialog";
import { isoToLocalInput, localInputToIso } from "./datetime-fields";
import { readErrorMessage } from "./response-error";
import type { TouchedRange } from "./use-calendar-chunks";

/** 対象日の指定方法。記念日・更新日は日付だけのことが多いため、時刻は任意にする。 */
type DateMode = "date" | "datetime";

export type ReminderDraft = {
  reminder?: ReminderItem;
  dateMode: DateMode;
  /** dateMode に応じて YYYY-MM-DD または YYYY-MM-DDTHH:mm */
  date: string;
};

/**
 * 日付リマインドの入力欄。ダイアログの枠と種類の切り替えは ItemDialog が持つ。
 * 開閉のアニメーションもそちらが持つため、ここでは保存できたことだけを伝える。
 */
export function ReminderForm({
  draft,
  timeZone,
  categories,
  title,
  autoFocusTitle,
  onTitleChange,
  onCancel,
  onSaved,
}: {
  draft: ReminderDraft;
  timeZone: string;
  /** 設定画面で登録済みの種類。無い名前もここから足せる（Notionが選択肢を増やす）。 */
  categories: TagOption[];
  /** タイトルは種類を切り替えても引き継ぐため、ItemDialog が持つ。 */
  title: string;
  autoFocusTitle: boolean;
  onTitleChange: (value: string) => void;
  onCancel: () => void;
  /** 保存後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  onSaved: (touched: TouchedRange[] | null) => void;
}) {
  const editing = draft.reminder;

  const [dateMode, setDateMode] = useState<DateMode>(draft.dateMode);
  const [date, setDate] = useState(draft.date);
  const [category, setCategory] = useState(editing?.category ?? "");
  const [memo, setMemo] = useState(editing?.memo ?? "");
  const [annual, setAnnual] = useState(editing?.annual ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 削除は取り消せない。押した直後には消さず、確認を挟む。
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 開いている途中で通信が落ちることがある（docs/spec.md §21）。
  const offline = useOffline();

  const dateError = !date
    ? dateMode === "datetime"
      ? "日付と時刻を入力してください。"
      : "日付を入力してください。"
    : null;

  const changeDateMode = (next: DateMode) => {
    const dateKey = date.slice(0, 10);
    setDate(next === "datetime" ? `${dateKey}T${date.slice(11, 16) || "09:00"}` : dateKey);
    setDateMode(next);
  };

  const buildDate = () =>
    dateMode === "date" ? date.slice(0, 10) : localInputToIso(date, timeZone);

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
        date: buildDate(),
        category: category.trim() || null,
        memo: memo.trim() || null,
        annual,
      };

      const response = await fetch(
        editing ? `/api/reminders/${encodeURIComponent(editing.pageId)}` : "/api/reminders",
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

      onSaved(touchedRanges(payload.date, payload.annual, editing));
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
          item={{ kind: "reminder", reminder: editing }}
          onCancel={() => setConfirmingDelete(false)}
          onDeleted={onSaved}
        />
      )}

      <div className="flex min-w-0 flex-col gap-4">
        <Input
          id="reminder-title"
          label="タイトル"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          autoFocus={autoFocusTitle}
        />

        <div className="flex flex-col gap-1.5">
          <Label>日付</Label>
          <div className="flex gap-1">
            {(
              [
                ["date", "日付のみ"],
                ["datetime", "日時指定"],
              ] as const
            ).map(([mode, label]) => (
              <Button
                key={mode}
                type="button"
                variant={dateMode === mode ? "secondary" : "outline"}
                size="sm"
                onClick={() => changeDateMode(mode)}
              >
                {label}
              </Button>
            ))}
          </div>
          {dateMode === "datetime" ? (
            <DateTimeInput
              id="reminder-date"
              dateLabel="日付"
              timeLabel="時刻"
              value={date}
              onChange={setDate}
            />
          ) : (
            <Input
              id="reminder-date"
              label="日付"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
        </div>

        {/* 種類はNotionのselectで1件につき1つ。押し直すと未設定へ戻せるようにする。 */}
        <TagPicker
          label="種類"
          options={categories}
          value={category ? [category] : []}
          multiple={false}
          onChange={(next) => setCategory(next[0] ?? "")}
        />

        <Textarea
          id="reminder-memo"
          label="メモ"
          rows={3}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />

        <label className="-my-1 flex min-h-11 items-center gap-3 px-4 text-base select-none md:text-sm">
          <Checkbox checked={annual} onCheckedChange={(v) => setAnnual(v === true)} />
          毎年
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

        {dateError && <p className="text-sm text-destructive">{dateError}</p>}
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
          <Button disabled={busy || offline || !title.trim() || dateError !== null} onClick={save}>
            保存
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

/**
 * 取り直しの対象。毎年の項目は表示中のどの月にも現れうるため、範囲を絞らず null を返す
 * （呼び出し側は保持しているすべての月を取り直す）。
 */
function touchedRanges(
  date: string | null,
  annual: boolean,
  editing: ReminderItem | undefined,
): TouchedRange[] | null {
  if (annual || editing?.annual) return null;

  const ranges: TouchedRange[] = [];
  if (date) ranges.push({ start: date, end: date });
  // 日付を動かした場合は移動元も変わる。展開していない項目は sourceDate と date が同じ。
  if (editing) ranges.push({ start: editing.sourceDate, end: editing.sourceDate });
  return ranges;
}

/** 編集用の初期値。ISO 8601 を入力欄の形式へ直す。 */
export function toReminderDraft(reminder: ReminderItem, timeZone: string): ReminderDraft {
  // 毎年の項目は表示中の年へ展開されている。編集するのは元ページなので登録した年に戻す。
  if (!reminder.hasTime) return { reminder, dateMode: "date", date: reminder.sourceDate };
  return {
    reminder,
    dateMode: "datetime",
    date: isoToLocalInput(reminder.sourceDate, timeZone),
  };
}
