"use client";

import { useOffline } from "next/offline";
import { useState } from "react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  EVENT_OUTCOME_KINDS,
  EVENT_OUTCOME_KIND_DESCRIPTIONS,
  EVENT_OUTCOME_KIND_LABELS,
  type CalendarEventItem,
  type EventOutcomeItem,
  type EventOutcomeKind,
} from "@/types/calendar";

import { EventOutcomeMark } from "./event-outcome-mark";
import { readErrorMessage } from "./response-error";

/**
 * 予定の中止・不参加を記録する（docs/spec.md §37）。
 *
 * 削除の確認（DeleteItemDialog）と同じく、予定の表示画面の中に重ねて開く。閉じるときは
 * 呼び出し元へ返す前にこちらを閉じ切る。開いたままアンマウントすると、Radixが<body>へ
 * 付けた pointer-events:none の後始末が走らず、画面全体が操作を受け付けなくなることがある。
 *
 * 記録を外すのに確認を挟まないのは、削除と違って戻す手立てがあるため（同じ画面でもう一度
 * 選び直せる）。消えるのは記録の一段だけで、予定はカレンダーに残る。
 */
export function EventOutcomeDialog({
  event,
  onCancel,
  onSaved,
}: {
  event: CalendarEventItem;
  onCancel: () => void;
  /** 保存・解除のあとの処理。付いた記録（外したときは null）を渡す。 */
  onSaved: (outcome: EventOutcomeItem | null) => void;
}) {
  const current = event.outcome ?? null;

  const [open, setOpen] = useState(true);
  // 既に記録があればその種類から始める。無いときは選ばせる（既定を置くと、開いて保存した
  // だけの操作でどちらかが黙って付く）。
  const [kind, setKind] = useState<EventOutcomeKind | null>(current?.kind ?? null);
  const [note, setNote] = useState(current?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開いている途中で通信が落ちることがある（docs/spec.md §21）。
  const offline = useOffline();

  const close = () => {
    setOpen(false);
    setTimeout(onCancel, 150);
  };

  const finish = (outcome: EventOutcomeItem | null) => {
    setOpen(false);
    setTimeout(() => onSaved(outcome), 150);
  };

  const url = `/api/events/${encodeURIComponent(event.id)}/outcome`;

  const save = async () => {
    if (!kind) return;
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId: event.calendarId, kind, note: note.trim() || null }),
      });

      if (!response.ok) {
        setError(await readErrorMessage(response, "記録できませんでした。"));
        return;
      }

      finish({ kind, note: note.trim() || null });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "記録に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, { method: "DELETE" });

      if (!response.ok) {
        setError(await readErrorMessage(response, "記録を外せませんでした。"));
        return;
      }

      finish(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "記録を外せませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>この予定に何がありましたか</DialogTitle>
          <DialogDescription>{event.title}</DialogDescription>
        </DialogHeader>

        {/*
          種類は2つだけ。チップの列ではなく説明を添えた枠にするのは、「中止」と「不参加」の
          違い（予定そのものが無くなったのか、自分が行かなかったのか）が名前だけでは
          決まらないため。選ぶ時点で両方の説明が見えている必要がある。
        */}
        <div className="grid grid-cols-2 gap-2">
          {EVENT_OUTCOME_KINDS.map((option) => {
            const selected = option === kind;

            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                disabled={busy}
                onClick={() => setKind(option)}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-md border px-2 py-2.5 text-center transition-colors disabled:opacity-38",
                  selected
                    ? "border-primary bg-primary-container text-on-primary-container"
                    : "border-outline-variant bg-surface-container-lowest hover:bg-primary/8",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-bold">
                  <EventOutcomeMark className="size-3.5" />
                  {EVENT_OUTCOME_KIND_LABELS[option]}
                </span>
                <span
                  className={cn(
                    "type-label-small leading-snug",
                    selected ? "opacity-85" : "text-on-surface-variant",
                  )}
                >
                  {EVENT_OUTCOME_KIND_DESCRIPTIONS[option]}
                </span>
              </button>
            );
          })}
        </div>

        <Textarea
          id="event-outcome-note"
          label="メモ（任意）"
          rows={2}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          onClear={() => setNote("")}
        />

        <p className="text-xs text-on-surface-variant">
          予定はカレンダーに残ります。Google Calendar側の予定は書き換えません。
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/*
          「やめる」は置かない。右上の ✕・画面外のタップ・Esc がすでに同じことをするため
          （docs/spec.md §15）。「記録を外す」は、まだ記録が付いていないときは出さない。
        */}
        <div className="flex flex-col gap-2 pt-2">
          <Button className="w-full" disabled={busy || !kind} onClick={save}>
            記録する
          </Button>

          {current && (
            <Button variant="destructive" className="w-full" disabled={busy} onClick={clear}>
              記録を外す
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
