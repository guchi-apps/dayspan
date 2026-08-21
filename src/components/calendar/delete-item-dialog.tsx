"use client";

import { useOffline } from "next/offline";
import { useState } from "react";

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
import { cn } from "@/lib/utils";
import type { CalendarEventItem, ReminderItem, TaskItem, TravelItem } from "@/types/calendar";

import { readErrorMessage } from "./response-error";
import { taskRanges, type TouchedRange } from "./use-calendar-chunks";

/** 削除の対象。編集画面からも表示画面からも同じ確認を通す。 */
export type DeletableItem =
  | {
      kind: "event";
      event: CalendarEventItem;
      /**
       * この予定に紐づいているタスクの名前（docs/spec.md §31）。予定を消すと紐づけも外れる。
       * 分かる画面からだけ渡す（カレンダーの取得範囲を持たない画面では引けない）。
       */
      linkedTasks?: string[];
    }
  | { kind: "task"; task: TaskItem }
  | { kind: "reminder"; reminder: ReminderItem }
  | { kind: "travel"; travel: TravelItem };

/** 繰り返し予定をどこまで消すか。Google Calendarの画面と同じ3通り。 */
type EventDeleteScope = "single" | "following" | "all";

const SCOPE_OPTIONS: { value: EventDeleteScope; label: string; description: string }[] = [
  { value: "single", label: "この予定", description: "選んだ回だけを削除します。" },
  {
    value: "following",
    label: "これ以降の予定",
    description: "選んだ回から後の回をまとめて削除します。前の回は残ります。",
  },
  { value: "all", label: "すべての予定", description: "繰り返し全体を削除します。" },
];

/**
 * 削除の確認（docs/spec.md §7・§10・§13）。
 *
 * 削除は押し間違えても戻す手立てが画面上に無く、繰り返し予定では1回分のつもりが
 * シリーズ全体に及びうる。実行の前に必ずここを通し、何がどこまで消えるかを示す。
 *
 * 表示画面・編集画面のダイアログの中に重ねて開く。閉じるときは、呼び出し元へ返す前に
 * こちらを閉じ切る。開いたままアンマウントすると、Radixが<body>へ付けた
 * pointer-events:noneの後始末が走らず、画面全体が操作を受け付けなくなることがある。
 */
export function DeleteItemDialog({
  item,
  onCancel,
  onDeleted,
}: {
  item: DeletableItem;
  onCancel: () => void;
  /** 削除後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  onDeleted: (touched: TouchedRange[] | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [scope, setScope] = useState<EventDeleteScope>("single");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開いている途中で通信が落ちることがある（docs/spec.md §21）。
  const offline = useOffline();

  const recurringEvent = item.kind === "event" && item.event.recurring;

  const close = () => {
    setOpen(false);
    setTimeout(onCancel, 150);
  };

  const finish = (touched: TouchedRange[] | null) => {
    setOpen(false);
    setTimeout(() => onDeleted(touched), 150);
  };

  const remove = async () => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(deleteUrl(item, scope), { method: "DELETE" });
      if (!response.ok) {
        setError(await readErrorMessage(response, "削除できませんでした。"));
        return;
      }
      finish(touchedRanges(item, scope));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "削除に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{TITLES[item.kind]}</DialogTitle>
          <DialogDescription>{describe(item)}</DialogDescription>
        </DialogHeader>

        {recurringEvent && (
          <div className="flex flex-col gap-2">
            {SCOPE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={scope === option.value ? "secondary" : "outline"}
                className={cn(
                  "h-auto flex-col items-start gap-0.5 py-2 text-left whitespace-normal",
                  scope === option.value && "text-on-secondary-container",
                )}
                onClick={() => setScope(option.value)}
              >
                <span className="type-label-large">{option.label}</span>
                <span className="type-body-small text-on-surface-variant">
                  {option.description}
                </span>
              </Button>
            ))}
          </div>
        )}

        {/*
          予定を消すと紐づけの相手が無くなる。押す前に、どのタスクの紐づけが外れるのかを示す
          （docs/spec.md §31）。予定日そのものはタスクに残るため、いつやるつもりだったかは失われない。
        */}
        {item.kind === "event" && item.linkedTasks && item.linkedTasks.length > 0 && (
          <p className="type-body-small text-on-surface-variant">
            {item.linkedTasks.map((title) => `「${title}」`).join("")}
            の紐づけが外れます。予定日はタスクに残ります。
          </p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={close}>
            やめる
          </Button>
          <Button variant="destructive" disabled={busy || offline} onClick={remove}>
            削除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TITLES: Record<DeletableItem["kind"], string> = {
  event: "予定を削除しますか？",
  task: "タスクを削除しますか？",
  reminder: "日付リマインドを削除しますか？",
  travel: "移動を削除しますか？",
};

/** 何がどこまで消えるかを1文で示す。戻せるかどうかは保存先によって違うため必ず添える。 */
function describe(item: DeletableItem): string {
  if (item.kind === "event") {
    const name = `「${item.event.title}」`;
    return item.event.recurring
      ? `${name}は繰り返しの予定です。どこまで削除するか選んでください。Google Calendarから消え、DaySpanからは元に戻せません。`
      : `${name}をGoogle Calendarから削除します。DaySpanからは元に戻せません。`;
  }

  if (item.kind === "task") {
    // 完了で次回分を作る方式のため、すでに作られた次回分はこの操作では消えない。
    const recurring =
      item.task.recurrence && item.task.recurrence !== "なし"
        ? "作成済みの次回分は残ります。"
        : "";
    return `「${item.task.title}」をNotionのゴミ箱へ移します。${recurring}Notionのゴミ箱から元に戻せます。`;
  }

  if (item.kind === "travel") {
    // Googleへ書き出してある移動は、そちらの予定も一緒に消える。往復のもう片方は残る。
    const exported = item.travel.exported
      ? "Googleカレンダーへ書き出した予定も削除します。"
      : "";
    return `「${item.travel.title}」を削除します。${exported}元に戻せません。`;
  }

  // 毎年の項目はカレンダー上の各年へ展開されている。元ページを消すとすべての年から消える。
  const annual = item.reminder.annual ? "毎年の項目のため、すべての年から消えます。" : "";
  return `「${item.reminder.title}」をNotionのゴミ箱へ移します。${annual}Notionのゴミ箱から元に戻せます。`;
}

function deleteUrl(item: DeletableItem, scope: EventDeleteScope): string {
  if (item.kind === "event") {
    const params = new URLSearchParams({ calendarId: item.event.calendarId, scope });
    return `/api/events/${encodeURIComponent(item.event.id)}?${params.toString()}`;
  }
  if (item.kind === "task") {
    return `/api/tasks/${encodeURIComponent(item.task.id)}`;
  }
  if (item.kind === "travel") {
    return `/api/travels/${encodeURIComponent(item.travel.id)}`;
  }
  // 毎年の項目を展開した回のIDは元ページを指さない。宛先には pageId を使う。
  return `/api/reminders/${encodeURIComponent(item.reminder.pageId)}`;
}

/**
 * 取り直しの対象。どこが変わるか事前に決まらないものは null を返す
 * （呼び出し側は保持しているすべての月を取り直す）。
 */
function touchedRanges(item: DeletableItem, scope: EventDeleteScope): TouchedRange[] | null {
  if (item.kind === "event") {
    // シリーズに及ぶ削除は、どの月に何回現れているか読めない。範囲を絞らない。
    if (scope !== "single") return null;
    return [{ start: item.event.start, end: item.event.end }];
  }

  if (item.kind === "task") {
    // 期限も予定日も無いタスクはカレンダーに出ないため、取り直す期間もない。
    return taskRanges(item.task);
  }

  if (item.kind === "travel") {
    return [{ start: item.travel.start, end: item.travel.end }];
  }

  if (item.reminder.annual) return null;
  return [{ start: item.reminder.sourceDate, end: item.reminder.sourceDate }];
}
