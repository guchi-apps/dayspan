"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { useEffect, useState, useTransition } from "react";
import { Square } from "lucide-react";

import { formatElapsed } from "@/components/calendar/activity-format";
import { readErrorMessage } from "@/components/calendar/response-error";
import { useNowIso } from "@/components/calendar/use-clock";
import { closeActivityNotification } from "@/components/notifications/activity-notification";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActivityPresetItem, RunningActivityItem } from "@/types/activity";

/**
 * メインナビの記録を長押ししたときに出るシート（docs/spec.md §27）。
 *
 * 記録を始める・終えるのは「いま」その瞬間の操作で、記録の画面を開いてから項目を探すのでは
 * 間に合わないことがある。見ている画面を離れずに、その場で始めて止められるようにする。
 */
export function ActivityQuickSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // オフライン中は書き込みを止める（docs/spec.md §21）。開始も停止も書き込み。
  const offline = useOffline();

  const [presets, setPresets] = useState<ActivityPresetItem[] | null>(null);
  const [running, setRunning] = useState<RunningActivityItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nowIso = useNowIso();

  /*
    項目と記録中の1件は、開いたときに取りにいく。

    下部ナビはカレンダー・タスク・日付の画面にも出るため、各画面のサーバー側で先に読むと
    開くたびにDBの読み取りが増える。記録中かどうかを取り直すのは、別の端末で開始・停止して
    いることがあるためで、ナビが持つ印（サーバー描画の時点の値）より新しい。
  */
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    void (async () => {
      // 前に開いたときの失敗をここで消す。開き直したのに古い理由が残っていると、
      // いまの取得が失敗しているように読める。
      setError(null);
      try {
        const response = await fetch("/api/activities");
        if (!response.ok) {
          if (!cancelled) setError(await readErrorMessage(response, "項目を取得できませんでした。"));
          return;
        }
        const body = (await response.json()) as {
          presets: ActivityPresetItem[];
          running: RunningActivityItem | null;
        };
        if (cancelled) return;
        setPresets(body.presets);
        setRunning(body.running);
      } catch {
        if (!cancelled) setError("項目を取得できませんでした。");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  const send = async (path: string, init: RequestInit, fallback: string): Promise<boolean> => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return false;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, init);
      if (!response.ok) {
        setError(await readErrorMessage(response, fallback));
        return false;
      }
      return true;
    } catch {
      setError(fallback);
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** 記録を始める。すでに記録中なら、そこまでを予定にしてから切り替わる（サーバー側で行う）。 */
  const start = async (preset: ActivityPresetItem) => {
    const ok = await send(
      "/api/activities/start",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId: preset.id }),
      },
      "記録を開始できませんでした。",
    );
    if (!ok) return;

    onOpenChange(false);
    // ナビの印と、いま見ている画面（記録から作られた予定が増えることがある）を取り直させる。
    startTransition(() => router.refresh());
  };

  const stop = async () => {
    const ok = await send("/api/activities/stop", { method: "POST" }, "記録を保存できませんでした。");
    if (!ok) return;

    onOpenChange(false);
    // 「記録中」の通知は止めた時点で事実と違う（docs/spec.md §32）。この端末のぶんを消す。
    void closeActivityNotification();
    startTransition(() => router.refresh());
  };

  const disabled = busy || offline;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position="bottom" className="gap-3">
        <DialogHeader>
          <DialogTitle>{running ? "記録中" : "記録を始める"}</DialogTitle>
          <DialogDescription>
            {running
              ? "止めた時点までがGoogle Calendarの予定になります。"
              : "押した時点から記録が始まります。"}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md bg-error-container/70 px-3 py-2 text-xs text-on-error-container">
            {error}
          </p>
        )}

        {/*
          記録中に長押しする理由は、まず止めること。停止を先頭に置き、切り替えはその下に並べる。
        */}
        {running && (
          <div className="flex items-center justify-between gap-3 rounded-lg bg-primary-container px-3 py-2.5 text-on-primary-container">
            <div className="flex min-w-0 flex-col">
              <span className="type-body-medium clip-nowrap">{running.title}</span>
              {nowIso && (
                <span className="type-title-medium tabular-nums">
                  {formatElapsed(running.startedAt, nowIso)}
                </span>
              )}
            </div>
            <Button size="sm" className="shrink-0" disabled={disabled} onClick={stop}>
              <Square className="fill-current" />
              停止して保存
            </Button>
          </div>
        )}

        {presets === null ? (
          <p className="type-body-small text-on-surface-variant">読み込んでいます…</p>
        ) : presets.length === 0 ? (
          <p className="type-body-small text-on-surface-variant">
            項目がありません。記録の画面から追加してください。
          </p>
        ) : (
          <>
            {running && <p className="type-title-small text-on-surface-variant">切り替える</p>}

            {/* 押す対象は指の幅で確保する。歩きながら・作業を切り替えながら押すため。 */}
            <div className="grid grid-cols-2 gap-2">
              {presets.map((preset) => {
                // 記録中の項目そのものを押しても、同じ内容で始め直すだけになる。
                const current = running?.title === preset.name;

                return (
                  <Button
                    key={preset.id}
                    variant={current ? "secondary" : "outline"}
                    className="type-title-small h-12 justify-center rounded-lg px-3"
                    disabled={disabled || current}
                    onClick={() => start(preset)}
                  >
                    <span className="truncate">{preset.name}</span>
                  </Button>
                );
              })}
            </div>
          </>
        )}

        {/* 項目の追加・その他を1回だけ記録することはこの画面では行わない（記録の画面にある）。 */}
        <Button variant="ghost" size="sm" asChild className="self-start">
          <Link href="/activity" onClick={() => onOpenChange(false)}>
            記録の画面へ
          </Link>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
