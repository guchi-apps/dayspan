"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { eventLeadLabel } from "@/lib/event-notification";
import type { EventNotificationOverride } from "@/types/calendar";
import { EVENT_LEAD_MINUTES } from "@/types/notification";

/**
 * 予定ごとの通知設定（issue #708）。編集画面（EventForm）の中に重ねて開く（issue #834）。
 *
 * APIは呼ばず、選んだ値をそのまま呼び出し側へ返すだけにする。実際の保存は、予定本体と
 * まとめて編集画面の「保存」を押したときに呼び出し側（event-form.tsx）が送る。
 */
export function EventNotificationDialog({
  title,
  initial,
  onCancel,
  onSaved,
}: {
  /** ダイアログの説明に出す予定名。 */
  title: string;
  initial: EventNotificationOverride | null;
  onCancel: () => void;
  /** 決定したときの処理。決めた上書き設定（通知しないを選んだときは null）を渡す。 */
  onSaved: (next: EventNotificationOverride | null) => void;
}) {
  const [open, setOpen] = useState(true);
  // 予定は既定では通知しない（issue #746）。入れた予定だけが通知の対象になる。
  const [enabled, setEnabled] = useState(initial?.enabled === true);
  // 切っている間も、選んでいた分数は残す（次に入れ直したときに選び直させないため）。
  const [leadMinutes, setLeadMinutes] = useState<number[]>(initial?.leadMinutes ?? [10]);

  const close = () => {
    setOpen(false);
    setTimeout(onCancel, 150);
  };

  const finish = (next: EventNotificationOverride | null) => {
    setOpen(false);
    setTimeout(() => onSaved(next), 150);
  };

  const toggleMinutes = (minutes: number) => {
    setLeadMinutes((current) =>
      current.includes(minutes)
        ? current.filter((value) => value !== minutes)
        : [...current, minutes].sort((a, b) => a - b),
    );
  };

  const invalid = enabled && leadMinutes.length === 0;

  const save = () => {
    if (invalid) return;
    finish(enabled ? { enabled: true, leadMinutes } : null);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>通知</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 rounded-md border border-outline-variant bg-surface-container-lowest px-3 py-3">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="event-notify">この予定を通知する</Label>
            <p className="type-label-small leading-snug text-on-surface-variant">
              入れた予定だけが通知されます。
            </p>
          </div>
          <Switch id="event-notify" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled && (
          <div className="flex flex-col gap-2">
            <p className="type-label-medium text-on-surface-variant">
              何分前に知らせるか（複数選ぶと、その回数ぶん通知します）
            </p>
            <div className="flex flex-wrap gap-2">
              {EVENT_LEAD_MINUTES.map((minutes) => {
                const selected = leadMinutes.includes(minutes);
                return (
                  <Button
                    key={minutes}
                    type="button"
                    size="sm"
                    variant={selected ? "secondary" : "outline"}
                    aria-pressed={selected}
                    onClick={() => toggleMinutes(minutes)}
                  >
                    {eventLeadLabel(minutes)}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {invalid && (
          <p className="text-sm text-destructive">何分前に知らせるかを1つ以上選んでください。</p>
        )}

        <Button className="w-full" disabled={invalid} onClick={save}>
          決定する
        </Button>
      </DialogContent>
    </Dialog>
  );
}
