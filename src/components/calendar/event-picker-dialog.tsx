"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getVisibleDays, parseMonthKey, shiftMonthKey } from "@/lib/calendar-range";
import { dayTone } from "@/lib/day-tone";
import { cn } from "@/lib/utils";
import { resolveStageDate } from "@/services/task-links/stage";
import {
  TASK_LINK_TARGET_LABELS,
  type CalendarEventItem,
  type TaskEventStage,
  type TaskLinkTarget,
} from "@/types/calendar";

import { isoToLocalInput } from "./datetime-fields";
import { createCalendarDateUtils } from "./item-layout";
import { readErrorMessage } from "./response-error";
import { formatLinkedDate } from "./task-link-label";
import { TaskStagePicker } from "./task-stage-picker";

/** 入力画面が保留しておく紐づけ先。タスクを保存するときに紐づける。 */
export type PendingEventLink = {
  calendarId: string;
  eventId: string;
  eventTitle: string;
  stage: TaskEventStage;
  /** 選んだ時点で決まる日時。入力画面に見せるための値で、実際に入る値は保存時にサーバーが決める。 */
  date: string;
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
// セルに並べる予定の数。それを超えた分は日付を押して下の一覧から選ぶ。
const CELL_LIMIT = 2;

/**
 * 予定を1つ選んで紐づけ先にする（issue #802・docs/spec.md §31）。
 *
 * 月表示と同じ見た目の簡易な月グリッドを出し、予定を押すと確認へ進む。ContinuousMonthView は
 * スワイプ・ドラッグ・長押しを前提にした作りで、ここで要るのは「1か月ぶんを見て1件選ぶ」だけのため使わない。
 * 予定は表示している月ぶんだけ取り、月を送ったときにだけ取り直す（外部APIへの往復を増やさない）。
 * 使用オフのカレンダーの予定も選べる。紐づけはGoogleへ書き込まないため。
 */
export function EventPickerDialog({
  target,
  timeZone,
  weekStartsOn,
  onCancel,
  onPick,
}: {
  target: TaskLinkTarget;
  timeZone: string;
  weekStartsOn: number;
  onCancel: () => void;
  onPick: (link: PendingEventLink) => void;
}) {
  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);
  const utils = useMemo(() => createCalendarDateUtils(timeZone), [timeZone]);

  const todayKey = useMemo(
    () => isoToLocalInput(new Date().toISOString(), timeZone).slice(0, 10),
    [timeZone],
  );
  const [monthKey, setMonthKey] = useState(() => todayKey.slice(0, 7));
  const [events, setEvents] = useState<CalendarEventItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const [chosen, setChosen] = useState<CalendarEventItem | null>(null);
  const [stage, setStage] = useState<TaskEventStage>("BEFORE_START");
  // 月を素早く送ったときに、遅れて届いた古い月の応答で上書きしない。
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    let cancelled = false;

    fetch(`/api/events?month=${monthKey}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readErrorMessage(response, "予定を取得できませんでした。"));
        return (await response.json()) as {
          events: CalendarEventItem[];
          errors?: { reason: string }[];
        };
      })
      .then((data) => {
        if (cancelled || id !== requestId.current) return;
        setEvents(data.events ?? []);
        // Googleの取得に失敗しても空として返る。空の月と区別できるよう理由を出す。
        setError(data.errors?.[0]?.reason ?? null);
      })
      .catch((cause: unknown) => {
        if (cancelled || id !== requestId.current) return;
        setEvents([]);
        setError(cause instanceof Error ? cause.message : "予定を取得できませんでした。");
      });

    return () => {
      cancelled = true;
    };
  }, [monthKey]);

  const weeks = useMemo(
    () => getVisibleDays("month", parseMonthKey(monthKey), weekStartsOn).weeks,
    [monthKey, weekStartsOn],
  );

  const eventsOn = (dateKey: string): CalendarEventItem[] =>
    (events ?? [])
      .filter((event) => utils.eventCoversDay(event, dateKey))
      // 終日を先に、続いて開始の早い順。
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));

  const close = () => {
    setOpen(false);
    setTimeout(onCancel, 150);
  };

  const choose = (event: CalendarEventItem) => {
    setChosen(event);
    setStage("BEFORE_START");
  };

  const confirm = () => {
    if (!chosen) return;
    const resolved = resolveStageDate(chosen, stage);

    setOpen(false);
    setTimeout(
      () =>
        onPick({
          calendarId: chosen.calendarId,
          eventId: chosen.id,
          eventTitle: chosen.title,
          stage,
          date: resolved.date,
        }),
      150,
    );
  };

  const targetLabel = TASK_LINK_TARGET_LABELS[target];
  const monthLabel = `${monthKey.slice(0, 4)}年${Number(monthKey.slice(5, 7))}月`;
  const focusEvents = focusDay ? eventsOn(focusDay) : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        {chosen ? (
          <>
            <DialogHeader>
              <DialogTitle>この予定に紐づけますか</DialogTitle>
              <DialogDescription className="sr-only">
                選んだ予定の段階から{targetLabel}の日時が決まります。
              </DialogDescription>
            </DialogHeader>

            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-col gap-0.5 rounded-lg bg-surface-container-high px-3 py-2">
                <b className="clip-nowrap text-sm">{chosen.title}</b>
                <span className="text-xs text-on-surface-variant">
                  {chosen.allDay
                    ? formatLinkedDate(chosen.start, timeZone)
                    : `${formatLinkedDate(chosen.start, timeZone)} 〜 ${formatLinkedDate(chosen.end, timeZone)}`}
                </span>
              </div>

              <TaskStagePicker value={stage} onChange={setStage} />

              <p className="text-sm text-on-surface-variant">
                {targetLabel}は{" "}
                <b className="text-on-surface">
                  {formatLinkedDate(resolveStageDate(chosen, stage).date, timeZone)}
                </b>{" "}
                になります。予定を動かすと{targetLabel}も動きます。
                タスクを保存すると紐づけが確定します。
              </p>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setChosen(null)}>
                選び直す
              </Button>
              <Button onClick={confirm}>OK</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{targetLabel}にする予定を選ぶ</DialogTitle>
              <DialogDescription className="type-body-small text-on-surface-variant">
                予定を押すと確認に進みます。
              </DialogDescription>
            </DialogHeader>

            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="前の月"
                  onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <div className="flex items-center gap-2">
                  <b className="text-sm">{monthLabel}</b>
                  {monthKey !== todayKey.slice(0, 7) && (
                    <Button variant="ghost" size="sm" onClick={() => setMonthKey(todayKey.slice(0, 7))}>
                      今日
                    </Button>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="次の月"
                  onClick={() => setMonthKey(shiftMonthKey(monthKey, 1))}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>

              <div
                className={cn(
                  "grid grid-cols-7 border-t border-l border-outline-variant transition-opacity",
                  events === null && "opacity-50",
                )}
              >
                {Array.from({ length: 7 }, (_, i) => WEEKDAYS[(weekStartsOn + i) % 7]).map((name) => (
                  <div
                    key={name}
                    className="border-r border-b border-outline-variant py-0.5 text-center text-[10px] text-on-surface-variant"
                  >
                    {name}
                  </div>
                ))}
                {weeks.flat().map((dateKey) => {
                  const inMonth = dateKey.slice(0, 7) === monthKey;
                  const dayEvents = inMonth ? eventsOn(dateKey) : [];

                  return (
                    <div
                      key={dateKey}
                      className={cn(
                        "flex min-h-14 min-w-0 flex-col gap-0.5 border-r border-b border-outline-variant p-0.5",
                        dateKey === focusDay && "bg-secondary-container/40",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setFocusDay(dateKey)}
                        className={cn(
                          "rounded px-0.5 text-right text-[10px]",
                          dayTone(dateKey) ?? "text-on-surface-variant",
                          !inMonth && "opacity-40",
                          dateKey === todayKey && "font-bold text-primary",
                        )}
                      >
                        {Number(dateKey.slice(8, 10))}
                      </button>
                      {dayEvents.slice(0, CELL_LIMIT).map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          title={event.title}
                          onClick={() => choose(event)}
                          className="clip-nowrap rounded-(--radius-item) border-l-[3px] border-primary bg-primary/10 px-1 text-left text-[10px] leading-4"
                        >
                          {event.title}
                        </button>
                      ))}
                      {dayEvents.length > CELL_LIMIT && (
                        <button
                          type="button"
                          onClick={() => setFocusDay(dateKey)}
                          className="text-left text-[10px] text-on-surface-variant"
                        >
                          他{dayEvents.length - CELL_LIMIT}件
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {focusDay && (
                <div className="flex flex-col rounded-md border border-outline-variant">
                  <p className="border-b border-outline-variant px-3 py-1.5 text-xs text-on-surface-variant">
                    {formatLinkedDate(focusDay, timeZone)}の予定
                  </p>
                  {focusEvents.length === 0 && (
                    <p className="px-3 py-3 text-sm text-muted-foreground">予定がありません。</p>
                  )}
                  {focusEvents.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => choose(event)}
                      className="flex items-center justify-between gap-3 border-b border-outline-variant px-3 py-2 text-left text-sm last:border-b-0 hover:bg-surface-container-high"
                    >
                      <span className="clip-nowrap">{event.title}</span>
                      <span className="shrink-0 text-xs text-on-surface-variant">
                        {event.allDay
                          ? "終日"
                          : formatLinkedDate(event.start, timeZone).split(" ")[1]}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {events === null && <p className="text-xs text-muted-foreground">読み込んでいます…</p>}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={close}>
                やめる
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
