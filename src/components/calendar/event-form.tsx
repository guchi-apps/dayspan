"use client";

import { useOffline } from "next/offline";
import { useState } from "react";

import { Bell, BellOff } from "lucide-react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dateKeyDiffDays } from "@/lib/calendar-range";
import type { PlaceCatalog } from "@/services/notion/places";
import type { CalendarEventItem, EventNotificationOverride, WritableCalendar } from "@/types/calendar";

import { CalendarChipSelect } from "./calendar-chip-select";
import { DateTimeInput } from "./date-time-input";
import { DeleteItemDialog } from "./delete-item-dialog";
import { isoToLocalInput, localInputToIso } from "./datetime-fields";
import { EventNotificationDialog } from "./event-notification-dialog";
import { ItemFormActions } from "./item-form-actions";
import { LocationInput } from "./location-input";
import { RecurrenceFields } from "./recurrence-fields";
import {
  buildRecurrenceRule,
  NO_RECURRENCE,
  recurrenceError,
  withStart,
  type RecurrenceInput,
} from "./recurrence-rule";
import { readErrorMessage } from "./response-error";
import { buildOptimisticEvent, type OptimisticEventChange } from "./optimistic-events";
import type { TouchedRange } from "./use-calendar-chunks";

export type EventDraft = {
  event?: CalendarEventItem;
  start: string;
  end: string;
  allDay: boolean;
  /** 簡易入力や複製から引き継いだ入力途中の値。新規作成のときだけ意味を持つ。 */
  title?: string;
  calendarId?: string;
  /** 複製から引き継ぐ場所・説明。新規作成のときだけ意味を持つ。 */
  location?: string;
  description?: string;
  /** 複製から引き継ぐ「仮の予定」かどうか（issue #688）。新規作成のときだけ意味を持つ。 */
  tentative?: boolean;
  /** 複製から引き継ぐ通知の上書き設定（issue #708）。新規作成のときだけ意味を持つ。 */
  notification?: EventNotificationOverride | null;
  /** 簡易入力から移ってきた入力。通知の設定ボタンを出さない（issue #739）。 */
  fromQuick?: boolean;
};

/**
 * 予定の入力欄。ダイアログの枠と種類の切り替えは ItemDialog が持つ。
 * 開閉のアニメーションもそちらが持つため、ここでは保存できたことだけを伝える。
 */
export function EventForm({
  draft,
  calendars,
  placeCatalog,
  timeZone,
  weekStartsOn,
  title,
  autoFocusTitle,
  onTitleChange,
  onSaved,
}: {
  draft: EventDraft;
  calendars: WritableCalendar[];
  /** 場所欄の入力候補。Notionの場所DBに登録済みのもの。 */
  placeCatalog: PlaceCatalog;
  timeZone: string;
  /** 繰り返す曜日を並べる順に使う。設定画面で選んだ週の開始曜日（0=日曜）。 */
  weekStartsOn: number;
  /** タイトルは種類を切り替えても引き継ぐため、ItemDialog が持つ。 */
  title: string;
  autoFocusTitle: boolean;
  onTitleChange: (value: string) => void;
  /**
   * 保存後の処理。変わった期間を渡し、呼び出し側がそこだけ取り直せるようにする。
   * どこが変わるか事前に決まらない場合（繰り返しの新規作成）は null を渡す。
   * 第2引数は、取り直しを待たずに画面へ重ねる保存後の予定（issue #787）。
   */
  onSaved: (touched: TouchedRange[] | null, change?: OptimisticEventChange) => void;
}) {
  const editing = draft.event;

  const [allDay, setAllDay] = useState(draft.allDay);
  const [start, setStart] = useState(draft.start);
  const [end, setEnd] = useState(draft.end);
  const [location, setLocation] = useState(editing?.location ?? draft.location ?? "");
  const [description, setDescription] = useState(editing?.description ?? draft.description ?? "");
  // 仮の予定（issue #688）。Googleのstatusフィールドをそのまま使うため、DaySpan独自DBは無い。
  const [tentative, setTentative] = useState(editing?.tentative ?? draft.tentative ?? false);
  // 予定ごとの通知設定（issue #708）。新規作成のときだけこのフォームから選べる。編集時は
  // 表示画面から即座に保存する専用の経路（EventDetailDialog）に一本化しているため、
  // ここでは触らない（draft.event が無いときだけ意味を持つ）。
  const [notification, setNotification] = useState<EventNotificationOverride | null>(
    draft.notification ?? null,
  );
  const [editingNotification, setEditingNotification] = useState(false);
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
        tentative,
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

      // 新規作成で返った予定のID。楽観的な反映（issue #787）と通知設定の保存に使う。
      const createdId = editing
        ? null
        : (((await response.json().catch(() => null)) as { id?: string } | null)?.id ?? null);

      // 新規作成で、繰り返しなし・通知をアカウント既定から変えている場合は、作成できた
      // eventIdを使って通知設定も送る（issue #708）。繰り返しの新規作成は対象外
      // （Googleが返すのはシリーズ親IDで、EventNotificationSetting.eventIdが指す
      // 「展開した1回分のID」とは異なるため。フォーム側でも通知ボタンをdisabledにしている）。
      // 失敗しても予定作成自体は成功として扱う（中止・不参加の記録のreplanNotificationsと
      // 同じベストエフォートの考え方。予定は作成できているので、失敗をここで止めない）。
      if (!editing && !recurrenceRule && notification) {
        if (createdId) {
          try {
            const notifyResponse = await fetch(
              `/api/events/${encodeURIComponent(createdId)}/notification`,
              {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  calendarId: payload.calendarId,
                  enabled: notification.enabled,
                  leadMinutes: notification.leadMinutes,
                }),
              },
            );
            if (!notifyResponse.ok) {
              console.error("[dayspan] event notification setting: save failed after create");
            }
          } catch (cause) {
            console.error("[dayspan] event notification setting: save failed after create:", cause);
          }
        }
      }

      // 移動した場合は移動元も変わる。繰り返しはどの月に何回現れるか読めないため範囲を絞らない。
      const touched: TouchedRange[] = [{ start: payload.start, end: payload.end }];
      if (editing) touched.push({ start: editing.start, end: editing.end });

      // 取り直しを待たずに、保存した内容を画面へ重ねる（issue #787）。繰り返しの新規作成は、
      // 展開された回のIDも現れる日も決まらないため重ねず、従来どおり取り直しを待つ。
      const savedId = editing ? editing.id : createdId;
      const change: OptimisticEventChange | undefined =
        !recurrenceRule && savedId
          ? {
              type: "upsert",
              item: {
                ...buildOptimisticEvent(payload, savedId, calendars, editing),
                ...(editing ? {} : { notification }),
              },
              previous: editing ? { calendarId: editing.calendarId, id: editing.id } : null,
              ranges: touched,
            }
          : undefined;

      onSaved(recurrenceRule ? null : touched, change);
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
          onClear={() => onTitleChange("")}
          autoFocus={autoFocusTitle}
        />

        {/*
          仮の予定（issue #688）。Google Calendarの status フィールドをそのまま使う
          （DaySpan独自のDBは持たない）。まだ本決まりでない予定を、削除せず区別して
          置いておけるようにするため。終日と同じ「予定の性質」のチェックなので横に並べる
          （issue #739）。
        */}
        <div className="-my-1 flex flex-wrap items-center gap-x-2">
          <label className="flex min-h-11 items-center gap-3 px-4 text-base select-none md:text-sm">
            <Checkbox checked={allDay} onCheckedChange={(v) => toggleAllDay(v === true)} />
            終日
          </label>
          <label className="flex min-h-11 items-center gap-3 px-4 text-base select-none md:text-sm">
            <Checkbox checked={tentative} onCheckedChange={(v) => setTentative(v === true)} />
            仮の予定
          </label>
        </div>

        {editingNotification && (
          <EventNotificationDialog
            title={title || "この予定"}
            initial={notification}
            onCancel={() => setEditingNotification(false)}
            onSaved={(next) => {
              setEditingNotification(false);
              setNotification(next);
            }}
          />
        )}

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

        {/*
          予定ごとの通知設定（issue #708）。新規作成のときだけこのフォームから選べる
          （編集時は表示画面の専用ボタンから即座に保存する）。簡易入力から
          移ってきたときは出さない（issue #739）。終日は通知の対象外
          （event-detail-dialog.tsxと同じ判断）。繰り返しを選んでいる間は保存後のeventIdが
          「シリーズ親ID」になり、展開後の1回分のIDとは異なるため設定できない。
        */}
        {!editing && !allDay && !draft.fromQuick && (
          <div className="flex flex-wrap items-center gap-2 px-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={notification?.enabled ? "bg-primary-container text-on-primary-container" : undefined}
              disabled={recurrence.frequency !== "none"}
              onClick={() => setEditingNotification(true)}
            >
              {!notification?.enabled ? (
                <BellOff className="size-4" />
              ) : (
                <Bell className="size-4" />
              )}
              通知
            </Button>
            {recurrence.frequency !== "none" && (
              <span className="type-label-small text-on-surface-variant">
                繰り返し予定は保存してから設定できます
              </span>
            )}
          </div>
        )}

        {!editing && (
          <RecurrenceFields
            value={recurrence}
            start={start}
            weekStartsOn={weekStartsOn}
            onChange={setRecurrence}
          />
        )}

        <LocationInput
          value={location}
          onChange={setLocation}
          places={placeCatalog.places}
          eventTitle={title}
          placeDatabaseReady={placeCatalog.ready}
        />

        <Textarea
          id="event-description"
          label="説明"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onClear={() => setDescription("")}
        />

        {inputError && <p className="text-sm text-destructive">{inputError}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <ItemFormActions
        saveDisabled={busy || offline || !title.trim() || !calendarId || inputError !== null}
        onSave={save}
        onDelete={editing ? () => setConfirmingDelete(true) : undefined}
        deleteDisabled={busy || offline}
      />
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

/**
 * 複製用の初期値。日時だけ現在の時間に置き換え、それ以外は元の予定を引き継ぐ。
 * `event` を含めないため新規作成として扱われ、繰り返しの入力欄も選び直せる。
 */
export function duplicateEventDraft(event: CalendarEventItem, timeZone: string): EventDraft {
  const { start, end } = event.allDay
    ? duplicateAllDayRange(event, timeZone)
    : duplicateTimedRange(event, timeZone);

  return {
    allDay: event.allDay,
    start,
    end,
    title: event.title,
    // 使用していないカレンダーの予定を複製するときは、元のカレンダーを引き継がない。
    // 保存先の選択肢に出ないカレンダーが初期値になると、そのままでは保存できない。
    calendarId: event.readOnly ? undefined : event.calendarId,
    location: event.location ?? undefined,
    description: event.description ?? undefined,
    tentative: event.tentative,
    notification: event.notification ?? null,
  };
}

function duplicateTimedRange(event: CalendarEventItem, timeZone: string) {
  const durationMs = new Date(event.end).getTime() - new Date(event.start).getTime();
  const now = new Date();
  return {
    start: isoToLocalInput(now.toISOString(), timeZone),
    end: isoToLocalInput(new Date(now.getTime() + durationMs).toISOString(), timeZone),
  };
}

function duplicateAllDayRange(event: CalendarEventItem, timeZone: string) {
  const durationDays = dateKeyDiffDays(event.start, event.end);
  const todayKey = isoToLocalInput(new Date().toISOString(), timeZone).slice(0, 10);
  return { start: todayKey, end: shiftDateKeyByDays(todayKey, durationDays) };
}

function shiftDateKeyByDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
