"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import { CalendarClock, CloudOff, MapPin, Pencil, Route, Trash2 } from "lucide-react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TRAVEL_MODE_LABELS, type TravelItem } from "@/types/calendar";

import { DeleteItemDialog } from "./delete-item-dialog";
import type { TouchedRange } from "./use-calendar-chunks";

/**
 * 移動の表示画面（docs/spec.md §29）。
 *
 * 削除はここからも行える。消すためだけに編集画面を開かせないため（docs/spec.md §15）。
 */
export function TravelDetailDialog({
  travel,
  timeZone,
  readOnly = false,
  onClose,
  onEdit,
  onDeleted,
}: {
  travel: TravelItem;
  timeZone: string;
  /** 閲覧のみにする。オフライン中に使う（docs/spec.md §21）。 */
  readOnly?: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDeleted: (touched: TouchedRange[] | null) => void;
}) {
  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
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

  const minutes = Math.max(
    1,
    Math.round((new Date(travel.end).getTime() - new Date(travel.start).getTime()) / 60_000),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {confirmingDelete && (
          <DeleteItemDialog
            item={{ kind: "travel", travel }}
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
          <DialogTitle className="pr-22">{travel.title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <DetailRow icon={<CalendarClock className="size-4" />}>
            {formatTravelTime(travel, timeZone)}
          </DetailRow>

          <DetailRow icon={<Route className="size-4" />}>
            {TRAVEL_MODE_LABELS[travel.mode]} {minutes}分
            {travel.estimated && (
              <span className="text-on-surface-variant">
                {travel.estimateSource === "TRANSIT" ? "（経路検索の平均）" : "（AIによる目安）"}
              </span>
            )}
          </DetailRow>

          <DetailRow icon={<MapPin className="size-4" />}>
            <span className="flex flex-col">
              <span>出発地: {travel.origin}</span>
              <span>目的地: {travel.destination}</span>
            </span>
          </DetailRow>

          {travel.note && (
            <p className="whitespace-pre-wrap text-on-surface-variant">{travel.note}</p>
          )}

          {/* 書き出せていない移動はDaySpanの中だけに見える。他の端末で探しても出てこないため伝える。 */}
          {!travel.exported && (
            <DetailRow icon={<CloudOff className="size-4" />}>
              <span className="text-xs text-on-surface-variant">
                Googleカレンダーには書き出されていません。設定 ▸ 移動 で書き出し先を確認してください。
              </span>
            </DetailRow>
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

/** 「2026年8月15日 8:20 – 9:00」。日をまたぐ移動は到着側にも日付を添える。 */
export function formatTravelTime(travel: TravelItem, timeZone: string): string {
  const date = (iso: string) =>
    new Intl.DateTimeFormat("ja-JP", {
      timeZone,
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(iso));

  const time = (iso: string) =>
    new Intl.DateTimeFormat("ja-JP", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));

  const startDate = date(travel.start);
  const endDate = date(travel.end);

  return startDate === endDate
    ? `${startDate} ${time(travel.start)} – ${time(travel.end)}`
    : `${startDate} ${time(travel.start)} – ${endDate} ${time(travel.end)}`;
}
