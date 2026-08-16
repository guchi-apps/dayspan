"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import { CalendarClock, ExternalLink, Pencil, RotateCw, Tag, Trash2 } from "lucide-react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { TagChip } from "@/components/tags/tag-chip";
import { tagColorOf } from "@/components/tags/tag-color";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TagOption } from "@/services/notion/tag-options";
import type { ReminderItem } from "@/types/calendar";

import { DeleteItemDialog } from "./delete-item-dialog";
import { reminderAnnualYearLabel } from "./item-layout";
import type { TouchedRange } from "./use-calendar-chunks";

export function ReminderDetailDialog({
  reminder,
  categoryOptions,
  timeZone,
  readOnly = false,
  onClose,
  onEdit,
  onDeleted,
}: {
  reminder: ReminderItem;
  /** 登録済みの種類。色を引くために渡す。取得できていないときは空でよい。 */
  categoryOptions: TagOption[];
  timeZone: string;
  /** 閲覧のみにする。オフライン中に使う（docs/spec.md §21）。 */
  readOnly?: boolean;
  onClose: () => void;
  onEdit: () => void;
  /** 削除後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  onDeleted: (touched: TouchedRange[] | null) => void;
}) {
  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
  // 削除は押した直後には実行せず、確認を挟む。
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const edit = () => {
    setOpen(false);
    setTimeout(onEdit, 150);
  };

  const deleted = (touched: TouchedRange[] | null) => {
    setOpen(false);
    setTimeout(() => onDeleted(touched), 150);
  };

  // ゴミの日はmyroomが正で、DaySpanからは読むだけ（docs/spec.md §9）。押せるまま残すと
  // サーバーが断るまで直せるように見えるため、編集・削除は入口ごと出さない。
  const external = reminder.source === "garbage";

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {confirmingDelete && (
          <DeleteItemDialog
            item={{ kind: "reminder", reminder }}
            onCancel={() => setConfirmingDelete(false)}
            onDeleted={deleted}
          />
        )}

        {!external && (
          <>
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
          </>
        )}

        <DialogHeader>
          <DialogTitle className={external ? "pr-6" : "pr-22"}>{reminder.title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <DetailRow icon={<CalendarClock className="size-4" />}>
            {formatReminderDate(reminder, timeZone)}
          </DetailRow>

          {reminder.annual && (
            <DetailRow icon={<RotateCw className="size-4" />}>
              毎年同じ月日に表示されます
            </DetailRow>
          )}

          {/* ゴミの日の種類は常に「ゴミの日」で、myroomが自分の書いたページを見分けるための
              目印でしかない。画面に出しても読める情報が増えないため出さない。 */}
          {reminder.category && !external && (
            <DetailRow icon={<Tag className="size-4" />}>
              <TagChip
                name={reminder.category}
                color={tagColorOf(categoryOptions, reminder.category)}
              />
            </DetailRow>
          )}

          {reminder.memo && (
            <p className="whitespace-pre-wrap text-on-surface-variant">{reminder.memo}</p>
          )}

          {reminder.url && (
            <a
              href={reminder.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
            >
              <ExternalLink className="size-3" />
              Notionで開く
            </a>
          )}

          {external && (
            <p className="text-xs text-on-surface-variant">
              ゴミの日はmyroomが毎日書き直すため、DaySpanからは変更できません。
            </p>
          )}

          {!external && readOnly && (
            <p className="text-xs text-on-surface-variant">{OFFLINE_WRITE_MESSAGE}</p>
          )}
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

function DetailRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** 表示用の日時。年月日を表示し、毎年の項目は括弧で年目情報を追加する。 */
export function formatReminderDate(reminder: ReminderItem, timeZone: string): string {
  const dateKey = reminder.date.slice(0, 10);
  const date = `${dateKey.slice(0, 4)}年${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`;
  const yearLabel = reminderAnnualYearLabel(reminder);
  const dateWithYear = yearLabel ? `${date}${yearLabel}` : date;

  if (!reminder.hasTime) return dateWithYear;

  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(reminder.date));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${dateWithYear} ${get("hour")}:${get("minute")}`;
}
