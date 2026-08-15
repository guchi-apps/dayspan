"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import { CalendarClock, Copy, MapPin, Pencil, RotateCw, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import type { CalendarEventItem } from "@/types/calendar";

import { DeleteItemDialog } from "./delete-item-dialog";
import type { TouchedRange } from "./use-calendar-chunks";

export function EventDetailDialog({
  event,
  timeZone,
  readOnly = false,
  onClose,
  onEdit,
  onDuplicate,
  onDeleted,
}: {
  event: CalendarEventItem;
  timeZone: string;
  /** 閲覧のみにする。オフライン中に使う（docs/spec.md §21）。 */
  readOnly?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  /** 削除後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  onDeleted: (touched: TouchedRange[] | null) => void;
}) {
  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
  // 削除は取り消せない。押した直後には消さず、確認を挟む。
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

  const duplicate = () => {
    setOpen(false);
    setTimeout(onDuplicate, 150);
  };

  const deleted = (touched: TouchedRange[] | null) => {
    setOpen(false);
    setTimeout(() => onDeleted(touched), 150);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {confirmingDelete && (
          <DeleteItemDialog
            item={{ kind: "event", event }}
            onCancel={() => setConfirmingDelete(false)}
            onDeleted={deleted}
          />
        )}

        {/*
          使用していないカレンダーの予定は、編集・削除の入口ごと出さない。押せるまま残すと、
          サーバーが断るまで直せるように見える。複製は残す（別のカレンダーへ写せる）。
        */}
        <div className="absolute top-2 right-10 flex items-center">
          <Button variant="ghost" size="icon-sm" aria-label="複製" disabled={readOnly} onClick={duplicate}>
            <Copy className="size-4" />
          </Button>

          {!event.readOnly && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="削除"
                disabled={readOnly}
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 className="size-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="編集"
                disabled={readOnly}
                onClick={edit}
              >
                <Pencil className="size-4" />
              </Button>
            </>
          )}
        </div>

        <DialogHeader>
          <DialogTitle className={event.readOnly ? "pr-22" : "pr-38"}>{event.title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <DetailRow icon={<CalendarClock className="size-4" />}>
            {formatEventRange(event, timeZone)}
          </DetailRow>

          <DetailRow
            icon={
              <span
                className="inline-block size-3 rounded-full"
                style={{ backgroundColor: event.color ?? undefined }}
              />
            }
          >
            {event.calendarName}
          </DetailRow>

          {event.location && (
            <DetailRow icon={<MapPin className="size-4" />}>{event.location}</DetailRow>
          )}

          {event.attendees.length > 0 && (
            <DetailRow icon={<Users className="size-4" />}>
              {event.attendees.join(", ")}
            </DetailRow>
          )}

          {event.recurring && (
            <DetailRow icon={<RotateCw className="size-4" />}>繰り返しの予定です</DetailRow>
          )}

          {event.description && (
            <p className="whitespace-pre-wrap text-on-surface-variant">{event.description}</p>
          )}

          {event.readOnly && (
            <p className="text-xs text-on-surface-variant">
              このカレンダーは表示のみに設定されています。予定を変更するには、設定のGoogle
              Calendarで「使用」をオンにしてください。
            </p>
          )}

          {readOnly && <p className="text-xs text-on-surface-variant">{OFFLINE_WRITE_MESSAGE}</p>}
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

/** 表示用の日時ラベル。終日は日付のみ、時刻ありは日付と時刻を並べる。 */
function formatEventRange(event: CalendarEventItem, timeZone: string): string {
  if (event.allDay) {
    const start = formatDateKey(event.start);
    return event.start === event.end ? start : `${start} 〜 ${formatDateKey(event.end)}`;
  }

  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  return `${formatParts(formatter.formatToParts(new Date(event.start)))} 〜 ${formatParts(formatter.formatToParts(new Date(event.end)))}`;
}

function formatParts(parts: Intl.DateTimeFormatPart[]): string {
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("month")}月${get("day")}日 ${get("hour")}:${get("minute")}`;
}

function formatDateKey(dateKey: string): string {
  return `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`;
}
