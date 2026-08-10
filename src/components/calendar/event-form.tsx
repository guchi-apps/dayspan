"use client";

import { useOffline } from "next/offline";
import { useState } from "react";

import { Trash2 } from "lucide-react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CalendarEventItem, WritableCalendar } from "@/types/calendar";

import { CalendarChipSelect } from "./calendar-chip-select";
import { DateTimeInput } from "./date-time-input";
import { DeleteItemDialog } from "./delete-item-dialog";
import { isoToLocalInput, localInputToIso } from "./datetime-fields";
import { RecurrenceFields } from "./recurrence-fields";
import {
  buildRecurrenceRule,
  NO_RECURRENCE,
  recurrenceError,
  withStart,
  type RecurrenceInput,
} from "./recurrence-rule";
import { readErrorMessage } from "./response-error";
import type { TouchedRange } from "./use-calendar-chunks";

export type EventDraft = {
  event?: CalendarEventItem;
  start: string;
  end: string;
  allDay: boolean;
  /** 簡易入力から引き継いだ入力途中の値。新規作成のときだけ意味を持つ。 */
  title?: string;
  calendarId?: string;
};

/**
 * 予定の入力欄。ダイアログの枠と種類の切り替えは ItemDialog が持つ。
 * 開閉のアニメーションもそちらが持つため、ここでは保存できたことだけを伝える。
 */
export function EventForm({
  draft,
  calendars,
  timeZone,
  weekStartsOn,
  title,
  autoFocusTitle,
  onTitleChange,
  onCancel,
  onSaved,
}: {
  draft: EventDraft;
  calendars: WritableCalendar[];
  timeZone: string;
  /** 繰り返す曜日を並べる順に使う。設定画面で選んだ週の開始曜日（0=日曜）。 */
  weekStartsOn: number;
  /** タイトルは種類を切り替えても引き継ぐため、ItemDialog が持つ。 */
  title: string;
  autoFocusTitle: boolean;
  onTitleChange: (value: string) => void;
  onCancel: () => void;
  /**
   * 保存後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。
   * どこが変わるか事前に決まらない場合（繰り返しの新規作成）は null を渡す。
   */
  onSaved: (touched: TouchedRange[] | null) => void;
}) {
  const editing = draft.event;

  const [allDay, setAllDay] = useState(draft.allDay);
  const [start, setStart] = useState(draft.start);
  const [end, setEnd] = useState(draft.end);
  const [location, setLocation] = useState(editing?.location ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [recurrence, setRecurrence] = useState<RecurrenceInput>(NO_RECURRENCE);
  const [calendarId, setCalendarId] = useState(
    editing?.calendarId ??
      draft.calendarId ??
      calendars.find((calendar) => calendar.isCreateDefault)?.calendarId ??
      calendars[0]?.calendarId ??
      "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 削除は取り消せない。押した直後には消さず、確認を挟む。
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 開いている途中で通信が落ちることがある（docs/spec.md §21）。
  const offline = useOffline();

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

    // 毎週の曜日は開始日から入る。自分で選び直していない間は、新しい開始日の曜日へ移す。
    setRecurrence((current) => withStart(current, start, value));
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

  // 繰り返しの入力欄は新規作成のときだけ出る。編集では規則を送らないため検証もしない。
  const inputError = rangeError ?? (editing ? null : recurrenceError(recurrence, start));

  // 終日と時刻指定では入力欄の形式が違う（date と datetime-local）。切り替え時に値を作り直す。
  const toggleAllDay = (next: boolean) => {
    if (next) {
      setStart(start.slice(0, 10));
      setEnd(end.slice(0, 10));
    } else {
      // 日付が空のまま時刻だけを足すと datetime として成立しない。空欄は空欄のまま渡す。
      setStart(start ? `${start.slice(0, 10)}T09:00` : "");
      setEnd(end ? `${end.slice(0, 10)}T10:00` : "");
    }
    setAllDay(next);
  };

  const save = async () => {
    // 開いている最中に通信が落ちることもある。押せない状態にするだけでなく、ここでも断つ。
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // 繰り返し規則は新規作成のときだけ送る（更新はシリーズ全体に及ぶため送らない）。
      const recurrenceRule = editing
        ? null
        : buildRecurrenceRule(recurrence, { allDay, timeZone });

      const payload = {
        calendarId,
        title,
        allDay,
        start: allDay ? start : localInputToIso(start, timeZone),
        end: allDay ? end : localInputToIso(end, timeZone),
        location: location.trim() || null,
        description: description.trim() || null,
        ...(editing
          ? { previousCalendarId: editing.calendarId }
          : { recurrenceRule }),
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

      // 移動した場合は移動元も変わる。繰り返しはどの月に何回現れるか読めないため範囲を絞らない。
      const touched: TouchedRange[] = [{ start: payload.start, end: payload.end }];
      if (editing) touched.push({ start: editing.start, end: editing.end });

      onSaved(recurrenceRule ? null : touched);
    } catch (cause) {
      // 日時の変換など、リクエスト送信前に失敗することもある。黙って閉じないよう画面に出す。
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {editing && confirmingDelete && (
        <DeleteItemDialog
          item={{ kind: "event", event: editing }}
          onCancel={() => setConfirmingDelete(false)}
          onDeleted={onSaved}
        />
      )}

      {editing?.recurring && (
        <DialogDescription>繰り返し予定のうち、この回だけが変更されます。</DialogDescription>
      )}

      {/* DialogContentはgrid。grid itemは既定でmin-width:autoのため、中に縮まない要素
          （保存先カレンダーのチップ列）があるとダイアログ自体が横に広がる。min-w-0で
          中身より狭くなれるようにし、はみ出す分はチップ列の中だけでスクロールさせる。 */}
      <div className="flex min-w-0 flex-col gap-4">
        <Input
          id="event-title"
          label="タイトル"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          autoFocus={autoFocusTitle}
        />

        <label className="-my-1 flex min-h-11 items-center gap-3 px-4 text-base select-none md:text-sm">
          <Checkbox checked={allDay} onCheckedChange={(v) => toggleAllDay(v === true)} />
          終日
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-2">
          {allDay ? (
            <>
              <Input
                id="event-start"
                label="開始"
                type="date"
                value={start}
                onChange={(e) => changeStart(e.target.value)}
              />
              <Input
                id="event-end"
                label="終了"
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </>
          ) : (
            <>
              <DateTimeInput
                id="event-start"
                dateLabel="開始日"
                timeLabel="開始時刻"
                value={start}
                onChange={changeStart}
              />
              <DateTimeInput
                id="event-end"
                dateLabel="終了日"
                timeLabel="終了時刻"
                value={end}
                onChange={setEnd}
              />
            </>
          )}
        </div>

        <CalendarChipSelect
          label="保存先カレンダー"
          value={calendarId}
          calendars={calendars}
          onChange={setCalendarId}
        />

        {!editing && (
          <RecurrenceFields
            value={recurrence}
            start={start}
            weekStartsOn={weekStartsOn}
            onChange={setRecurrence}
          />
        )}

        <Input
          id="event-location"
          label="場所"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />

        <Textarea
          id="event-description"
          label="説明"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {inputError && <p className="text-sm text-destructive">{inputError}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter className="sm:justify-between">
        {editing ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || offline}
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="size-4" />
            削除
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            やめる
          </Button>
          <Button
            disabled={busy || offline || !title.trim() || !calendarId || inputError !== null}
            onClick={save}
          >
            保存
          </Button>
        </div>
      </DialogFooter>
    </>
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
