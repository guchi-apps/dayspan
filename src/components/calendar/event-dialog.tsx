"use client";

import { useState } from "react";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CalendarEventItem, WritableCalendar } from "@/types/calendar";

import { isoToLocalInput, localInputToIso } from "./datetime-fields";

const RECURRENCE_RULES: { label: string; rule: string | null }[] = [
  { label: "繰り返さない", rule: null },
  { label: "毎日", rule: "RRULE:FREQ=DAILY" },
  { label: "毎週", rule: "RRULE:FREQ=WEEKLY" },
  { label: "毎月", rule: "RRULE:FREQ=MONTHLY" },
  { label: "毎年", rule: "RRULE:FREQ=YEARLY" },
];

export type EventDraft = {
  event?: CalendarEventItem;
  start: string;
  end: string;
  allDay: boolean;
};

export function EventDialog({
  draft,
  calendars,
  timeZone,
  onClose,
  onSaved,
}: {
  draft: EventDraft;
  calendars: WritableCalendar[];
  timeZone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = draft.event;

  const [title, setTitle] = useState(editing?.title ?? "");
  const [allDay, setAllDay] = useState(draft.allDay);
  const [start, setStart] = useState(draft.start);
  const [end, setEnd] = useState(draft.end);
  const [location, setLocation] = useState(editing?.location ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [attendees, setAttendees] = useState((editing?.attendees ?? []).join(", "));
  const [recurrenceRule, setRecurrenceRule] = useState<string>("none");
  const [calendarId, setCalendarId] = useState(
    editing?.calendarId ??
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

  const finish = () => {
    setOpen(false);
    setTimeout(onSaved, 150);
  };

  // 開始を動かしたら、それまでの所要時間を保ったまま終了も動かす。
  // Google Calendarと同じ挙動にして、終了が開始より前になる状態を作りにくくする。
  const changeStart = (value: string) => {
    const previous = inputToDate(start, allDay);
    const next = inputToDate(value, allDay);

    if (previous && next) {
      const durationMs = Math.max((inputToDate(end, allDay)?.getTime() ?? 0) - previous.getTime(), 0);
      const nextEnd = new Date(next.getTime() + durationMs);
      setEnd(dateToInput(nextEnd, allDay));
    }

    setStart(value);
  };

  // 文字列は同じ書式でゼロ埋めされているため、そのまま比較して前後関係が判定できる。
  const rangeError = (() => {
    if (!start || !end) return "開始日時と終了日時を入力してください。";
    if (allDay) {
      return end < start ? "終了日が開始日より前になっています。" : null;
    }
    return end <= start ? "終了日時が開始日時より後になるようにしてください。" : null;
  })();

  // 終日と時刻指定では入力欄の形式が違う（date と datetime-local）。切り替え時に値を作り直す。
  const toggleAllDay = (next: boolean) => {
    if (next) {
      setStart(start.slice(0, 10));
      setEnd(end.slice(0, 10));
    } else {
      setStart(`${start.slice(0, 10)}T09:00`);
      setEnd(`${end.slice(0, 10)}T10:00`);
    }
    setAllDay(next);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        calendarId,
        title,
        allDay,
        start: allDay ? start : localInputToIso(start, timeZone),
        end: allDay ? end : localInputToIso(end, timeZone),
        location: location.trim() || null,
        description: description.trim() || null,
        attendees: attendees
          .split(/[,\s]+/)
          .map((value) => value.trim())
          .filter(Boolean),
        ...(editing
          ? {}
          : { recurrenceRule: RECURRENCE_RULES.find((r) => r.label === recurrenceRule)?.rule ?? null }),
      };

      const response = await fetch(
        editing ? `/api/events/${encodeURIComponent(editing.id)}` : "/api/events",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        setError(await readErrorMessage(response, "保存できませんでした。"));
        return;
      }
      finish();
    } catch (cause) {
      // 日時の変換など、リクエスト送信前に失敗することもある。黙って閉じないよう画面に出す。
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(editing.id)}?calendarId=${encodeURIComponent(editing.calendarId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError(await readErrorMessage(response, "削除できませんでした。"));
        return;
      }
      finish();
    } catch (cause) {
      // 日時の変換など、リクエスト送信前に失敗することもある。黙って閉じないよう画面に出す。
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "予定を編集" : "予定を追加"}</DialogTitle>
          {editing?.recurring && (
            <DialogDescription>
              繰り返し予定のうち、この回だけが変更されます。
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-title">タイトル</Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={allDay} onCheckedChange={(v) => toggleAllDay(v === true)} />
            終日
          </label>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-start">開始</Label>
              <Input
                id="event-start"
                type={allDay ? "date" : "datetime-local"}
                value={start}
                onChange={(e) => changeStart(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="event-end">終了</Label>
              <Input
                id="event-end"
                type={allDay ? "date" : "datetime-local"}
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          {!editing && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>保存先カレンダー</Label>
                <Select value={calendarId} onValueChange={setCalendarId}>
                  <SelectTrigger>
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
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>繰り返し</Label>
                <Select value={recurrenceRule} onValueChange={setRecurrenceRule}>
                  <SelectTrigger>
                    <SelectValue placeholder="繰り返さない" />
                  </SelectTrigger>
                  <SelectContent>
                    {RECURRENCE_RULES.map((option) => (
                      <SelectItem
                        key={option.label}
                        value={option.rule === null ? "none" : option.label}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-location">場所</Label>
            <Input
              id="event-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-attendees">参加者</Label>
            <Input
              id="event-attendees"
              placeholder="メールアドレスをカンマ区切りで"
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-description">説明</Label>
            <Textarea
              id="event-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {rangeError && <p className="text-sm text-destructive">{rangeError}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="sm:justify-between">
          {editing ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={remove}>
              <Trash2 className="size-4" />
              削除
            </Button>
          ) : (
            <span />
          )}
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 入力欄の値をDateへ。終日は日付のみなのでUTC正午として扱い、日付のずれを避ける。 */
function inputToDate(value: string, allDay: boolean): Date | null {
  if (!value) return null;
  const date = new Date(allDay ? `${value}T12:00:00Z` : `${value}:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateToInput(date: Date, allDay: boolean): string {
  const iso = date.toISOString();
  return allDay ? iso.slice(0, 10) : iso.slice(0, 16);
}

/** 編集用の初期値。ISO 8601 を入力欄の形式へ直す。 */
export function toEventDraft(event: CalendarEventItem, timeZone: string): EventDraft {
  return {
    event,
    allDay: event.allDay,
    start: event.allDay ? event.start : isoToLocalInput(event.start, timeZone),
    end: event.allDay ? event.end : isoToLocalInput(event.end, timeZone),
  };
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
