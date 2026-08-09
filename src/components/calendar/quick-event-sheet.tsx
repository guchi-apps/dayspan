"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WritableCalendar } from "@/types/calendar";

import { localInputToIso } from "./datetime-fields";
import type { EventDraft } from "./event-dialog";
import { MINUTES_PER_DAY } from "./item-layout";
import type { TouchedRange } from "./use-calendar-chunks";

export type QuickEventDraft = {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  startTime: string;
  /** HH:mm */
  endTime: string;
};

/**
 * 押した位置から作る初期値。既定の長さは1時間とし、日をまたがないところで止める。
 * 日をまたぐ予定はこの画面では作れないため、23:00より後を押した場合はその日の終わりまでになる。
 */
export function toQuickEventDraft(dateKey: string, startMinutes: number): QuickEventDraft {
  return {
    date: dateKey,
    startTime: formatMinutes(startMinutes),
    endTime: formatMinutes(Math.min(startMinutes + 60, MINUTES_PER_DAY - 1)),
  };
}

/**
 * カレンダーの空いているところを押したときに出る簡易入力。
 *
 * 日付と時刻は押した位置ですでに決まっているため、全項目の入力欄を出すと
 * 直す欄より埋まっている欄のほうが多くなる。ここではタイトル・時間・カレンダーだけを受け取り、
 * 場所や説明を入れたい場合は「詳細」から通常の入力画面へ引き継ぐ。
 *
 * 画面の下側に寄せるのは、指の届く範囲へ入力欄と保存ボタンを置くため。
 */
export function QuickEventSheet({
  draft,
  calendars,
  timeZone,
  onClose,
  onSaved,
  onOpenDetail,
}: {
  draft: QuickEventDraft;
  calendars: WritableCalendar[];
  timeZone: string;
  onClose: () => void;
  /** 保存後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。 */
  onSaved: (touched: TouchedRange[] | null) => void;
  /** 入力済みの値を持ったまま、通常の入力画面へ移る。 */
  onOpenDetail: (draft: EventDraft) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(draft.date);
  const [startTime, setStartTime] = useState(draft.startTime);
  const [endTime, setEndTime] = useState(draft.endTime);
  const [calendarId, setCalendarId] = useState(
    calendars.find((calendar) => calendar.isCreateDefault)?.calendarId ??
      calendars[0]?.calendarId ??
      "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 開いたままアンマウントすると、Radixが<body>へ付けたpointer-events:noneの後始末が
  // 走らず、画面全体が操作を受け付けなくなることがある。閉じ切ってから呼び出し元へ返す。
  const [open, setOpen] = useState(true);

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) close();
  };

  // 開始を動かしたら、それまでの長さを保ったまま終了も動かす。
  // 押した位置から作った1時間を、開始だけ直すたびに作り直さずに済む。
  const changeStartTime = (value: string) => {
    const previous = toMinutes(startTime);
    const next = toMinutes(value);
    const finish = toMinutes(endTime);

    if (previous !== null && next !== null && finish !== null && finish > previous) {
      setEndTime(formatMinutes(Math.min(next + (finish - previous), MINUTES_PER_DAY - 1)));
    }

    setStartTime(value);
  };

  // 同じ書式でゼロ埋めされているため、文字列のまま比較して前後関係が判定できる。
  const rangeError = (() => {
    if (!date || !startTime || !endTime) return "日付と時刻を入力してください。";
    return endTime <= startTime ? "終了時刻が開始時刻より後になるようにしてください。" : null;
  })();

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        calendarId,
        title,
        allDay: false,
        start: localInputToIso(`${date}T${startTime}`, timeZone),
        end: localInputToIso(`${date}T${endTime}`, timeZone),
      };

      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        setError(await readErrorMessage(response, "保存できませんでした。"));
        return;
      }

      setOpen(false);
      setTimeout(() => onSaved([{ start: payload.start, end: payload.end }]), 150);
    } catch (cause) {
      // 日時の変換など、リクエスト送信前に失敗することもある。黙って閉じないよう画面に出す。
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const openDetail = () => {
    setOpen(false);
    setTimeout(
      () =>
        onOpenDetail({
          allDay: false,
          start: join(date, startTime),
          end: join(date, endTime),
          title,
          calendarId,
        }),
      150,
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        position="bottom"
        showCloseButton={false}
        className="max-h-[80dvh] gap-3 overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>予定を追加</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            id="quick-event-title"
            label="タイトル"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />

          {/* 日付は押した日から動かさないことが多い。時刻2つより幅を取らせない。 */}
          <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)_minmax(0,2fr)] gap-2">
            <Input
              id="quick-event-date"
              label="日付"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <Input
              id="quick-event-start"
              label="開始"
              type="time"
              value={startTime}
              onChange={(e) => changeStartTime(e.target.value)}
            />
            <Input
              id="quick-event-end"
              label="終了"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>

          <Select value={calendarId} onValueChange={setCalendarId}>
            <SelectTrigger label="保存先カレンダー">
              <SelectValue placeholder="カレンダーを選択" />
            </SelectTrigger>
            <SelectContent>
              {calendars.map((calendar) => (
                <SelectItem key={calendar.calendarId} value={calendar.calendarId}>
                  {calendar.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {rangeError && <p className="text-sm text-destructive">{rangeError}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={openDetail}>
            詳細
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={close}>
              やめる
            </Button>
            <Button
              disabled={busy || !title.trim() || !calendarId || rangeError !== null}
              onClick={save}
            >
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** HH:mm を0:00からの分数へ。入力途中で読み取れない場合は null。 */
function toMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** 日付と時刻を datetime-local と同じ形式へ。片方が空の間は結合できない。 */
function join(date: string, time: string): string {
  return date && time ? `${date}T${time}` : "";
}

/** サーバーが返した失敗理由を取り出す。無い場合は既定の文言にする。 */
async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? fallback;
  } catch {
    return fallback;
  }
}
