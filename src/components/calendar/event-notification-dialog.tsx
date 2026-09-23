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
import { eventLeadLabel } from "@/lib/event-notification";
import { cn } from "@/lib/utils";
import type { EventNotificationOverride } from "@/types/calendar";
import { EVENT_LEAD_MINUTES } from "@/types/notification";

import { readErrorMessage } from "./response-error";

type Mode = "default" | "off" | "custom";

function modeOf(value: EventNotificationOverride | null): Mode {
  if (!value) return "default";
  return value.enabled ? "custom" : "off";
}

/**
 * 予定ごとの通知設定（issue #708）。
 *
 * 削除の確認（DeleteItemDialog）・中止不参加の記録（EventOutcomeDialog）と同じく、
 * 予定の表示画面や編集フォームの中に重ねて開く。
 *
 * 保存済みの予定（`persist` あり）では選ぶたびに即座にAPIを叩く（EventOutcomeDialogと
 * 同じ「即時反映」パターン）。新規作成フォーム（`persist` なし、まだ eventId が無い）では
 * APIを呼ばず、選んだ値をそのまま呼び出し側へ返すだけにする（フォームの保存時にまとめて送る）。
 */
export function EventNotificationDialog({
  title,
  initial,
  persist,
  onCancel,
  onSaved,
}: {
  /** ダイアログの説明に出す予定名。 */
  title: string;
  initial: EventNotificationOverride | null;
  /** 渡されたときは選択のたびに即座にAPIを叩く。渡されないときはローカルの選択値だけ返す。 */
  persist?: { eventId: string; calendarId: string };
  onCancel: () => void;
  /** 保存・解除のあとの処理。決めた上書き設定（アカウント既定に戻したときは null）を渡す。 */
  onSaved: (next: EventNotificationOverride | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<Mode>(modeOf(initial));
  // 通知しないを選んでいる間も、選んでいた分数は残す（次にカスタムへ戻したときに
  // 選び直させないため。通知設定画面の既存の扱いと同じ）。
  const [leadMinutes, setLeadMinutes] = useState<number[]>(initial?.leadMinutes ?? [10]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開いている途中で通信が落ちることがある（docs/spec.md §21）。
  const offline = useOffline();

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

  const invalid = mode === "custom" && leadMinutes.length === 0;

  const save = async () => {
    if (invalid) return;

    const next: EventNotificationOverride | null =
      mode === "default" ? null : { enabled: mode === "custom", leadMinutes };

    // 新規作成フォームではまだ eventId が無いため、ここでは保存せず値だけ返す。
    // フォームの保存（予定の作成）が成功したあとに呼び出し側がまとめて送る。
    if (!persist) {
      finish(next);
      return;
    }

    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const url = `/api/events/${encodeURIComponent(persist.eventId)}/notification`;

      const response =
        mode === "default"
          ? await fetch(url, { method: "DELETE" })
          : await fetch(url, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                calendarId: persist.calendarId,
                enabled: mode === "custom",
                leadMinutes,
              }),
            });

      if (!response.ok) {
        setError(await readErrorMessage(response, "設定できませんでした。"));
        return;
      }

      finish(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "設定に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>通知</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <ModeOption
            label="アカウントの設定に従う"
            description="通知の設定でまとめて決めた内容がそのまま使われます。"
            selected={mode === "default"}
            disabled={busy}
            onClick={() => setMode("default")}
          />
          <ModeOption
            label="通知しない"
            description="この予定だけ通知を出しません。"
            selected={mode === "off"}
            disabled={busy}
            onClick={() => setMode("off")}
          />
          <ModeOption
            label="この予定だけ設定する"
            description="何分前に知らせるかを選びます。複数選ぶと、その回数ぶん通知します。"
            selected={mode === "custom"}
            disabled={busy}
            onClick={() => setMode("custom")}
          />
        </div>

        {mode === "custom" && (
          <div className="flex flex-wrap gap-2 pl-1">
            {EVENT_LEAD_MINUTES.map((minutes) => {
              const selected = leadMinutes.includes(minutes);
              return (
                <Button
                  key={minutes}
                  type="button"
                  size="sm"
                  variant={selected ? "secondary" : "outline"}
                  disabled={busy}
                  onClick={() => toggleMinutes(minutes)}
                >
                  {eventLeadLabel(minutes)}
                </Button>
              );
            })}
          </div>
        )}

        {invalid && (
          <p className="text-sm text-destructive">何分前に知らせるかを1つ以上選んでください。</p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button className="w-full" disabled={busy || invalid} onClick={save}>
          {persist ? "保存する" : "決定する"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function ModeOption({
  label,
  description,
  selected,
  disabled,
  onClick,
}: {
  label: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2.5 text-left transition-colors disabled:opacity-38",
        selected
          ? "border-primary bg-primary-container text-on-primary-container"
          : "border-outline-variant bg-surface-container-lowest hover:bg-primary/8",
      )}
    >
      <span className="text-sm font-bold">{label}</span>
      <span
        className={cn(
          "type-label-small leading-snug",
          selected ? "opacity-85" : "text-on-surface-variant",
        )}
      >
        {description}
      </span>
    </button>
  );
}
