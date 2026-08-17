"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { EMPTY_PLACE_CATALOG, type PlaceCatalog } from "@/services/notion/places";
import { EMPTY_TAG_CATALOG, type TagCatalog } from "@/services/notion/tag-options";
import type { WritableCalendar } from "@/types/calendar";

import { EventForm, type EventDraft } from "./event-form";
import { ReminderForm, type ReminderDraft } from "./reminder-form";
import { TaskForm, type TaskDraft } from "./task-form";
import { TravelForm, type TravelDraft } from "./travel-form";
import type { TouchedRange } from "./use-calendar-chunks";

export type ItemKind = "event" | "task" | "reminder" | "travel";

/**
 * 開く対象。追加では作れる種類ぶんを渡し、画面上で切り替えられるようにする。
 * 編集は種類を変えられないため1つだけ渡す（予定をタスクに作り変えることはできない）。
 */
export type ItemDrafts = {
  event?: EventDraft;
  task?: TaskDraft;
  reminder?: ReminderDraft;
  travel?: TravelDraft;
};

const KIND_LABELS: { kind: ItemKind; label: string }[] = [
  { kind: "event", label: "予定" },
  { kind: "task", label: "タスク" },
  { kind: "reminder", label: "リマインド" },
  { kind: "travel", label: "移動" },
];

/**
 * 予定・タスク・日付リマインドの入力ダイアログ（docs/spec.md §15）。
 *
 * 追加のときは、どれを作るかを開いてから選べるようにする。押す前に決めさせると、
 * 押した先の画面で入力の途中に気付いても、閉じて選び直すことになるため。
 * 枠をここが持ち、中身だけを差し替えるのは、Radixのダイアログを開いたまま
 * アンマウントすると<body>のpointer-events:noneが残ることがあるため。
 */
export function ItemDialog({
  initialKind,
  drafts,
  calendars = [],
  tagCatalog = EMPTY_TAG_CATALOG,
  placeCatalog = EMPTY_PLACE_CATALOG,
  timeZone,
  weekStartsOn = 0,
  onClose,
  onSaved,
}: {
  initialKind: ItemKind;
  drafts: ItemDrafts;
  /** 予定の保存先。予定を扱わない画面（タスク・日付リマインド一覧）では渡さない。 */
  calendars?: WritableCalendar[];
  /** 登録済みのタグ・種類。設定画面で登録したものを入力の候補として渡す。 */
  tagCatalog?: TagCatalog;
  /** 登録済みの場所。予定の場所欄の入力候補として渡す。 */
  placeCatalog?: PlaceCatalog;
  timeZone: string;
  /** 繰り返す曜日を並べる順に使う。予定を扱わない画面では渡さない。 */
  weekStartsOn?: number;
  onClose: () => void;
  /** 保存後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  onSaved: (touched: TouchedRange[] | null) => void;
}) {
  const [kind, setKind] = useState<ItemKind>(initialKind);
  // タイトルは種類によらず必ず入れる項目。切り替えで消えると入れ直しになるため引き継ぐ。
  const [title, setTitle] = useState(() => draftTitle(initialKind, drafts));
  // 切り替えたあとは入力欄へ自動で移らない。スマートフォンでは切り替えるたびに
  // キーボードが立ち上がり、選び直している最中の画面を覆ってしまうため。
  const [switched, setSwitched] = useState(false);

  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const finish = (touched: TouchedRange[] | null) => {
    setOpen(false);
    setTimeout(() => onSaved(touched), 150);
  };

  const selectable = KIND_LABELS.filter((item) => drafts[item.kind] !== undefined);
  const editing = isEditing(kind, drafts);
  const label = KIND_LABELS.find((item) => item.kind === kind)?.label ?? "";

  const shared = {
    title,
    autoFocusTitle: !switched,
    onTitleChange: setTitle,
    onCancel: close,
    onSaved: finish,
    timeZone,
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `${label}を編集` : `${label}を追加`}</DialogTitle>

          {/* M3のセグメンテッドボタン。排他的な選択であることを、隣接した枠で示す。 */}
          {selectable.length > 1 && (
            <div className="flex items-center self-start overflow-hidden rounded-full border border-outline">
              {selectable.map((item) => (
                <Button
                  key={item.kind}
                  type="button"
                  variant={kind === item.kind ? "secondary" : "ghost"}
                  size="xs"
                  className={cn(
                    "type-label-large h-9 rounded-none px-4",
                    kind === item.kind && "text-on-secondary-container",
                  )}
                  onClick={() => {
                    setKind(item.kind);
                    setSwitched(true);
                  }}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          )}
        </DialogHeader>

        {kind === "event" && drafts.event && (
          <EventForm
            {...shared}
            draft={drafts.event}
            calendars={calendars}
            placeCatalog={placeCatalog}
            weekStartsOn={weekStartsOn}
          />
        )}
        {kind === "task" && drafts.task && (
          <TaskForm {...shared} draft={drafts.task} tagOptions={tagCatalog.task ?? []} />
        )}
        {kind === "reminder" && drafts.reminder && (
          <ReminderForm
            {...shared}
            draft={drafts.reminder}
            categories={tagCatalog.reminder ?? []}
          />
        )}
        {/* 移動はタイトルを持たない（出発地と目的地から決まる）。共通の項目のうち
            タイトルに関わるものは渡さない。 */}
        {kind === "travel" && drafts.travel && (
          <TravelForm
            draft={drafts.travel}
            placeCatalog={placeCatalog}
            timeZone={timeZone}
            onCancel={close}
            onSaved={finish}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 開いた時点のタイトル。編集は既存の値、簡易入力からの引き継ぎは入力途中の値。 */
function draftTitle(kind: ItemKind, drafts: ItemDrafts): string {
  if (kind === "event") return drafts.event?.event?.title ?? drafts.event?.title ?? "";
  if (kind === "task") return drafts.task?.task?.title ?? "";
  // 移動のタイトルは出発地と目的地から決まるため、切り替えで引き継ぐ文字列を持たない。
  if (kind === "travel") return "";
  return drafts.reminder?.reminder?.title ?? "";
}

function isEditing(kind: ItemKind, drafts: ItemDrafts): boolean {
  if (kind === "event") return Boolean(drafts.event?.event);
  if (kind === "task") return Boolean(drafts.task?.task);
  if (kind === "travel") return Boolean(drafts.travel?.travel);
  return Boolean(drafts.reminder?.reminder);
}
