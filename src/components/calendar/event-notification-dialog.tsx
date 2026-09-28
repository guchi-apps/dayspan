"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { eventLeadLabel, isValidLeadMinutes } from "@/lib/event-notification";
import type { EventNotificationOverride } from "@/types/calendar";
import { EVENT_LEAD_MINUTES, MAX_EVENT_LEAD_MINUTES } from "@/types/notification";

const MAX_LEAD_HOURS = Math.floor(MAX_EVENT_LEAD_MINUTES / 60);

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

  // 好きな時間の追加欄（issue #849）。時間・分の2欄にするのは、7.5のような小数を打たせない
  // ため（所定労働時間・目標睡眠時間と同じ・sleep-section.tsx）。
  const [adding, setAdding] = useState(false);
  const [hourDraft, setHourDraft] = useState("");
  const [minuteDraft, setMinuteDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const hourInputRef = useRef<HTMLInputElement>(null);

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

  // 表示するチップ = 定義済みの候補（EVENT_LEAD_MINUTES）∪ 選択中だが候補に無い値
  // （好きな時間で足したカスタム値）。過去にカスタム値で保存した設定を開き直しても、
  // そのチップが選択状態のまま見えるようにする（tag-picker.tsx の extras と同じ考え方）。
  const definedMinutes = new Set<number>(EVENT_LEAD_MINUTES);
  const customMinutes = leadMinutes.filter((minutes) => !definedMinutes.has(minutes));
  const chipMinutes = [...new Set([...EVENT_LEAD_MINUTES, ...customMinutes])].sort(
    (a, b) => a - b,
  );

  const openAdding = () => {
    setAdding(true);
    setHourDraft("");
    setMinuteDraft("");
    setDraftError(null);
    // 描画されてから当てる。開いた直後に入力を始められるようにする。
    setTimeout(() => hourInputRef.current?.focus(), 0);
  };

  const commitDraft = () => {
    // 分の欄を空にしただけで確定できなくならないよう、空欄は0として扱う（睡眠の目標時間と同じ）。
    const hours = hourDraft.trim() === "" ? 0 : Number(hourDraft);
    const mins = minuteDraft.trim() === "" ? 0 : Number(minuteDraft);

    if (!Number.isInteger(hours) || !Number.isInteger(mins) || hours < 0 || mins < 0 || mins > 59) {
      setDraftError("時間と分を正しく入力してください。");
      return;
    }

    const total = hours * 60 + mins;
    if (!isValidLeadMinutes(total)) {
      setDraftError(`0分〜${MAX_LEAD_HOURS}時間の範囲で指定してください。`);
      return;
    }

    if (!leadMinutes.includes(total)) {
      setLeadMinutes((current) => [...current, total].sort((a, b) => a - b));
    }
    setAdding(false);
    setDraftError(null);
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
              {chipMinutes.map((minutes) => {
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
              {!adding && (
                <Button type="button" variant="outline" size="sm" onClick={openAdding}>
                  <Plus className="size-4" />
                  好きな時間
                </Button>
              )}
            </div>

            {adding && (
              <div className="flex flex-col gap-2 rounded-md border border-outline-variant p-2">
                <div className="flex items-center gap-2">
                  <Input
                    ref={hourInputRef}
                    aria-label="時間"
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min="0"
                    max={MAX_LEAD_HOURS}
                    placeholder="0"
                    className="h-10 w-16 min-w-0 text-center"
                    value={hourDraft}
                    onChange={(event) => setHourDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitDraft();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setAdding(false);
                      }
                    }}
                  />
                  <span className="type-label-medium text-on-surface-variant">時間</span>
                  <Input
                    aria-label="分"
                    type="number"
                    inputMode="numeric"
                    step="1"
                    min="0"
                    max="59"
                    placeholder="0"
                    className="h-10 w-16 min-w-0 text-center"
                    value={minuteDraft}
                    onChange={(event) => setMinuteDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commitDraft();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setAdding(false);
                      }
                    }}
                  />
                  <span className="type-label-medium text-on-surface-variant">分前</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={commitDraft}>
                    追加
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>
                    やめる
                  </Button>
                </div>
                {draftError && <p className="type-label-small text-destructive">{draftError}</p>}
              </div>
            )}
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
