"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Settings2, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ActivityPresetItem, ActivitySavedRange, RunningActivityItem } from "@/types/activity";

import { formatElapsed } from "./activity-format";
import { DateTimeInput } from "./date-time-input";
import { isoToLocalInput, localInputToIso } from "./datetime-fields";
import { readErrorMessage } from "./response-error";
import { useNowIso } from "./use-clock";

/**
 * いましていることを記録する画面（docs/spec.md §27）。
 *
 * 押した時点から記録が始まり、止めた時点でGoogle Calendarの予定になる。
 * 記録中に別の項目を押すと、そこまでを予定にして次の記録へ切り替える。止める操作を
 * 挟ませると、切り替えのたびに記録の無い時間帯ができてしまうため。
 *
 * 画面の下側に寄せるのは、片手で押せる範囲に選択肢と停止ボタンを置くため。
 */
export function ActivitySheet({
  presets,
  running,
  timeZone,
  onClose,
  onRunningChange,
  onSaved,
}: {
  presets: ActivityPresetItem[];
  running: RunningActivityItem | null;
  timeZone: string;
  onClose: () => void;
  /** 記録中の項目が変わったとき。カレンダー側の帯を即座に描き替えるために渡す。 */
  onRunningChange: (running: RunningActivityItem | null) => void;
  /**
   * 予定として保存されたとき。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。
   * 保存を伴わない操作（開始・取り消し）では呼ばない。
   */
  onSaved: (touched: ActivitySavedRange[]) => void;
}) {
  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  // 開始時刻の修正欄。押し忘れて後から気付くほうが多いため、記録中でも直せるようにする。
  const [editingStart, setEditingStart] = useState(false);
  const [startInput, setStartInput] = useState("");

  const nowIso = useNowIso();
  const contentRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  /** 保存まで済んだ操作のあと。閉じ切ってから、変わった期間を呼び出し元へ渡す。 */
  const finish = (touched: ActivitySavedRange[]) => {
    setOpen(false);
    setTimeout(() => onSaved(touched), 150);
  };

  const send = async (
    path: string,
    init: RequestInit,
    fallback: string,
  ): Promise<Record<string, unknown> | null> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, init);
      if (!response.ok) {
        setError(await readErrorMessage(response, fallback));
        return null;
      }
      return (await response.json().catch(() => ({}))) as Record<string, unknown>;
    } catch {
      setError(fallback);
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** 記録を始める（記録中なら、そこまでを予定にしてから切り替える）。 */
  const start = async (body: { presetId?: string; title?: string }) => {
    const result = await send(
      "/api/activities/start",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      "記録を開始できませんでした。",
    );
    if (!result) return;

    onRunningChange((result.running as RunningActivityItem) ?? null);

    // 切り替えでは前の記録が予定になっている。その期間だけ取り直させる。
    const saved = result.saved as ActivitySavedRange | null;
    if (saved) {
      finish([saved]);
      return;
    }

    close();
  };

  const stop = async () => {
    const result = await send("/api/activities/stop", { method: "POST" }, "記録を保存できませんでした。");
    if (!result) return;

    onRunningChange(null);
    finish([result.saved as ActivitySavedRange]);
  };

  const discard = async () => {
    const result = await send(
      "/api/activities/running",
      { method: "DELETE" },
      "記録を取り消せませんでした。",
    );
    if (!result) return;

    onRunningChange(null);
    close();
  };

  const saveStart = async () => {
    if (!startInput) return;

    const result = await send(
      "/api/activities/running",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startedAt: localInputToIso(startInput, timeZone) }),
      },
      "開始時刻を変更できませんでした。",
    );
    if (!result) return;

    onRunningChange(result.running as RunningActivityItem);
    setEditingStart(false);
  };

  const beginEditStart = () => {
    if (!running) return;
    setStartInput(isoToLocalInput(running.startedAt, timeZone));
    setEditingStart(true);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        ref={contentRef}
        position="bottom"
        showCloseButton={false}
        className="max-h-[80dvh] gap-3 overflow-y-auto"
        // 開いた時点で入力欄へフォーカスを移さない。スマートフォンではその場でキーボードが
        // 立ち上がり、シートの下半分（選択肢と停止ボタン）を覆ってしまう。
        // ここで押したいのはほとんどの場合、文字ではなく選択肢のほうなので。
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{running ? "記録中" : "何を記録しますか？"}</DialogTitle>
          <DialogDescription>
            止めた時点までがカレンダーの予定になります。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-3">
          {running && (
            <div className="flex flex-col gap-2 rounded-lg bg-primary-container/60 px-3 py-2.5 text-on-primary-container">
              <div className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
                <span className="type-title-small clip-nowrap flex-1">{running.title}</span>
                {/* 経過時間は現在時刻に依存する。値が入るまでは出さない（use-clock.ts）。 */}
                {nowIso && (
                  <span className="type-label-large shrink-0 tabular-nums">
                    {formatElapsed(running.startedAt, nowIso)}
                  </span>
                )}
              </div>

              {editingStart ? (
                <div className="flex flex-col gap-2">
                  <DateTimeInput
                    id="activity-started-at"
                    dateLabel="開始日"
                    timeLabel="開始時刻"
                    value={startInput}
                    onChange={setStartInput}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditingStart(false)}>
                      やめる
                    </Button>
                    <Button size="sm" disabled={busy || !startInput} onClick={saveStart}>
                      開始時刻を直す
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="type-body-small">
                    {isoToLocalInput(running.startedAt, timeZone).replace("T", " ")} から
                  </span>
                  {/* 押し忘れて後から始めることが多い。開始時刻をここで直せるようにする。 */}
                  <Button variant="ghost" size="xs" disabled={busy} onClick={beginEditStart}>
                    開始時刻を直す
                  </Button>
                </div>
              )}

              <div className="flex items-center justify-between gap-2">
                {/* 押し間違えて始めた記録まで予定にすると、消しにいく手間のほうが大きい。 */}
                <Button variant="destructive" size="sm" disabled={busy} onClick={discard}>
                  取り消す
                </Button>
                <Button size="sm" disabled={busy} onClick={stop}>
                  <Square className="fill-current" />
                  停止して保存
                </Button>
              </div>
            </div>
          )}

          {presets.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="type-label-medium text-on-surface-variant">
                {running ? "切り替える" : "記録を始める"}
              </span>
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => {
                  // 記録中の項目そのものを押しても、同じ内容で開始し直すだけになる。
                  // 選択中であることを示し、押せないようにする。
                  const current = running?.title === preset.name;

                  return (
                    <Button
                      key={preset.id}
                      variant={current ? "secondary" : "outline"}
                      size="sm"
                      className="h-10 rounded-lg"
                      disabled={busy || current}
                      onClick={() => start({ presetId: preset.id })}
                    >
                      {preset.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/*
            選択肢に無いことを1回だけ記録する欄。
            設定画面へ項目を足しに行かせると、いま始めたい記録がその間ずっと止まる。
          */}
          <div className="flex items-end gap-2">
            {/* ラベル付きの入力欄は枠（fieldShell）が幅を持つため、伸ばすのは外側の箱にする。 */}
            <div className="min-w-0 flex-1">
              <Input
                id="activity-title"
                label="その他"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && title.trim() && !busy) start({ title: title.trim() });
                }}
              />
            </div>
            <Button
              className="h-14 shrink-0"
              disabled={busy || !title.trim()}
              onClick={() => start({ title: title.trim() })}
            >
              開始
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/settings/activities">
              <Settings2 />
              項目を編集
            </Link>
          </Button>
          <Button variant="ghost" disabled={busy} onClick={close}>
            閉じる
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
