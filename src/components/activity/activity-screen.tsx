"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";
import { useState, useTransition } from "react";
import { Settings2, Square, Timer } from "lucide-react";

import { formatElapsed } from "@/components/calendar/activity-format";
import { DateTimeInput } from "@/components/calendar/date-time-input";
import { isoToLocalInput, localInputToIso } from "@/components/calendar/datetime-fields";
import { readErrorMessage } from "@/components/calendar/response-error";
import { useNowIso } from "@/components/calendar/use-clock";
import { BottomNav, HeaderNav } from "@/components/nav/main-nav";
import { OFFLINE_WRITE_MESSAGE, OfflineNotice } from "@/components/offline/offline-notice";
import { useWarmOfflinePage } from "@/components/offline/offline-page-cache";
import { useReconnectRefresh } from "@/components/offline/use-reconnect-refresh";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LinearProgress } from "@/components/ui/linear-progress";
import type { ActivityPresetItem, RunningActivityItem } from "@/types/activity";

/**
 * 活動記録の画面（docs/spec.md §27）。
 *
 * いましていることを押して記録を始め、止めた時点までをGoogle Calendarの予定にする。
 * カレンダーの中ではなく独立した画面にしてあるのは、記録を始める・終えるのが
 * 「いま」その瞬間の操作で、カレンダーのどの期間を見ているかとは関係が無いため。
 */
export function ActivityScreen({
  presets,
  initialRunning,
  timeZone,
}: {
  presets: ActivityPresetItem[];
  initialRunning: RunningActivityItem | null;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // オフライン中は書き込みを止める（docs/spec.md §21）。記録の開始・停止はすべて書き込み。
  const offline = useOffline();
  useReconnectRefresh();

  // オフラインでこの画面を開けるよう、表示中にHTMLを保存しておく（issue #321）。
  // ナビからの移動はソフトナビゲーションで、Service Worker が保存できないため。
  useWarmOfflinePage("/activity");

  const [running, setRunning] = useState(initialRunning);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  // 開始時刻の修正欄。押し忘れて後から気付くほうが多いため、記録中でも直せるようにする。
  const [editingStart, setEditingStart] = useState(false);
  const [startInput, setStartInput] = useState("");

  const nowIso = useNowIso();

  // 開始・停止は画面側で先に反映するが、正はサーバーにある（別の端末で止めることもある）。
  // 取り直しでサーバーの値が変わったら、そちらへ戻す。
  const serverRunningKey = runningKey(initialRunning);
  const [knownRunningKey, setKnownRunningKey] = useState(serverRunningKey);
  if (knownRunningKey !== serverRunningKey) {
    setKnownRunningKey(serverRunningKey);
    setRunning(initialRunning);
  }

  const send = async (
    path: string,
    init: RequestInit,
    fallback: string,
  ): Promise<Record<string, unknown> | null> => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return null;
    }

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

  /**
   * 記録を始める。すでに記録中なら、そこまでを予定にしてから切り替わる。
   * 予定ができた場合はカレンダー側も古くなるため、サーバーから取り直させる。
   */
  const start = async (body: { presetId?: string; title?: string }) => {
    const result = await send(
      "/api/activities/start",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      "記録を開始できませんでした。",
    );
    if (!result) return;

    setRunning((result.running as RunningActivityItem) ?? null);
    setTitle("");
    startTransition(() => router.refresh());
  };

  const stop = async () => {
    const result = await send("/api/activities/stop", { method: "POST" }, "記録を保存できませんでした。");
    if (!result) return;

    setRunning(null);
    startTransition(() => router.refresh());
  };

  const discard = async () => {
    // 予定にせず捨てるため、押し間違えると記録した時間が戻らない。実行の前に確認する。
    const confirmed = window.confirm(
      `「${running?.title}」の記録を取り消します。\nカレンダーには保存されません。よろしいですか？`,
    );
    if (!confirmed) return;

    const result = await send(
      "/api/activities/running",
      { method: "DELETE" },
      "記録を取り消せませんでした。",
    );
    if (!result) return;

    setRunning(null);
    startTransition(() => router.refresh());
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

    setRunning(result.running as RunningActivityItem);
    setEditingStart(false);
    startTransition(() => router.refresh());
  };

  const beginEditStart = () => {
    if (!running) return;
    setStartInput(isoToLocalInput(running.startedAt, timeZone));
    setEditingStart(true);
  };

  const disabled = busy || offline;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-2 bg-surface-container-low px-2 py-2">
        <div className="flex shrink-0 items-center gap-1 font-semibold">
          <Timer className="size-5" />
          <span className="hidden lg:inline">DaySpan</span>
        </div>

        <HeaderNav current="activity" activityRunning={running !== null} />

        <span className="flex-1" />

        <Button variant="ghost" size="sm" asChild>
          <Link href="/settings/activities">
            <Settings2 className="size-4" />
            <span className="hidden sm:inline">項目を編集</span>
          </Link>
        </Button>
      </header>

      <LinearProgress active={pending || busy} />

      <OfflineNotice />

      {error && (
        <div className="bg-error-container/70 px-3 py-2 text-xs text-on-error-container">{error}</div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
          {running ? (
            <RunningCard
              running={running}
              nowIso={nowIso}
              timeZone={timeZone}
              disabled={disabled}
              editingStart={editingStart}
              startInput={startInput}
              onStartInputChange={setStartInput}
              onBeginEditStart={beginEditStart}
              onCancelEditStart={() => setEditingStart(false)}
              onSaveStart={saveStart}
              onStop={stop}
              onDiscard={discard}
            />
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-1 py-8 text-center">
                <Timer className="size-8 text-on-surface-variant" />
                <p className="type-title-medium">いま記録しているものはありません</p>
                <p className="type-body-small text-on-surface-variant">
                  下から項目を押すと、その時点から記録が始まります。
                </p>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col gap-2">
            <h2 className="type-title-small text-on-surface-variant">
              {running ? "切り替える" : "記録を始める"}
            </h2>

            {presets.length === 0 ? (
              <p className="type-body-medium text-on-surface-variant">
                項目がありません。「項目を編集」からよく記録するものを追加してください。
              </p>
            ) : (
              // 押す対象は指の幅で確保する。記録は歩きながら・作業を切り替えながら押すことが
              // 多く、狙って押さなければならない大きさだと、その場で押すのをやめてしまう。
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {presets.map((preset) => {
                  // 記録中の項目そのものを押しても、同じ内容で開始し直すだけになる。
                  const current = running?.title === preset.name;

                  return (
                    <Button
                      key={preset.id}
                      variant={current ? "secondary" : "outline"}
                      className="type-title-small h-16 justify-center rounded-lg px-3"
                      disabled={disabled || current}
                      onClick={() => start({ presetId: preset.id })}
                    >
                      <span className="truncate">{preset.name}</span>
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          {/*
            選択肢に無いことを1回だけ記録する欄。
            設定画面へ項目を足しに行かせると、いま始めたい記録がその間ずっと止まる。
          */}
          <div className="flex items-end gap-2">
            {/* ラベル付きの入力欄は枠（fieldShell）が幅を持つため、伸ばすのは外側の箱にする。 */}
            <div className="min-w-0 flex-1">
              <Input
                id="activity-title"
                label="その他（1回だけ記録する）"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && title.trim() && !disabled) start({ title: title.trim() });
                }}
              />
            </div>
            <Button
              className="h-14 shrink-0"
              disabled={disabled || !title.trim()}
              onClick={() => start({ title: title.trim() })}
            >
              開始
            </Button>
          </div>

          <p className="type-body-small text-on-surface-variant">
            止めた時点までがGoogle Calendarの予定になります。保存先のカレンダーは「項目を編集」から選べます。
          </p>
        </div>
      </div>

      <BottomNav current="activity" activityRunning={running !== null} timeZone={timeZone} />
    </div>
  );
}

/**
 * 記録中の1件。経過時間をいちばん大きく出す。
 * この画面を開く理由のほとんどは「どれくらい経ったか」と「止めること」のため。
 */
function RunningCard({
  running,
  nowIso,
  timeZone,
  disabled,
  editingStart,
  startInput,
  onStartInputChange,
  onBeginEditStart,
  onCancelEditStart,
  onSaveStart,
  onStop,
  onDiscard,
}: {
  running: RunningActivityItem;
  /** 現在時刻。サーバー描画の時点では持たないため null になりうる（use-clock.ts）。 */
  nowIso: string | null;
  timeZone: string;
  disabled: boolean;
  editingStart: boolean;
  startInput: string;
  onStartInputChange: (value: string) => void;
  onBeginEditStart: () => void;
  onCancelEditStart: () => void;
  onSaveStart: () => void;
  onStop: () => void;
  onDiscard: () => void;
}) {
  return (
    <Card className="bg-primary-container text-on-primary-container">
      <CardContent className="flex flex-col gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* 動いていることを形でも示す。色だけでは、止め忘れているかどうかが分からない。 */}
          <span aria-hidden className="size-2.5 shrink-0 animate-pulse rounded-full bg-primary" />
          <span className="type-title-medium clip-nowrap flex-1">{running.title}</span>
        </div>

        {/* この画面を開く理由のほとんどは「どれくらい経ったか」と「止めること」。
            経過時間は画面で最も大きい字にする（用意してある中で一番大きいのが headline-small）。 */}
        {nowIso && (
          <div className="type-headline-small tabular-nums">
            {formatElapsed(running.startedAt, nowIso)}
          </div>
        )}

        {editingStart ? (
          <div className="flex flex-col gap-2">
            <DateTimeInput
              id="activity-started-at"
              dateLabel="開始日"
              timeLabel="開始時刻"
              value={startInput}
              onChange={onStartInputChange}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" disabled={disabled} onClick={onCancelEditStart}>
                やめる
              </Button>
              <Button size="sm" disabled={disabled || !startInput} onClick={onSaveStart}>
                開始時刻を直す
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="type-body-medium">
              {isoToLocalInput(running.startedAt, timeZone).replace("T", " ")} から
            </span>
            {/* 押し忘れて後から始めることが多い。開始時刻をここで直せるようにする。 */}
            <Button variant="ghost" size="sm" disabled={disabled} onClick={onBeginEditStart}>
              開始時刻を直す
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          {/* 押し間違えて始めた記録まで予定にすると、消しにいく手間のほうが大きい。 */}
          <Button variant="destructive" size="sm" disabled={disabled} onClick={onDiscard}>
            取り消す
          </Button>
          <Button size="lg" disabled={disabled} onClick={onStop}>
            <Square className="fill-current" />
            停止して保存
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * 記録中の項目が同じものかを比べるための文字列。
 * サーバーから来る値は取り直しのたびに別のオブジェクトになるため、参照では比べられない。
 */
function runningKey(running: RunningActivityItem | null): string {
  return running ? `${running.title} ${running.startedAt}` : "";
}
