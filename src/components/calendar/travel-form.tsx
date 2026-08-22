"use client";

import { useOffline } from "next/offline";
import { useState } from "react";

import { Route } from "lucide-react";

import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { TravelEstimate } from "@/lib/ai-travel-estimate";
import type { PlaceCatalog } from "@/services/notion/places";
import { TRAVEL_MODES, TRAVEL_MODE_LABELS, type TravelItem, type TravelMode } from "@/types/calendar";

import { DateTimeInput } from "./date-time-input";
import { DeleteItemDialog } from "./delete-item-dialog";
import { isoToLocalInput, localInputToIso } from "./datetime-fields";
import { ItemFormActions } from "./item-form-actions";
import { LocationInput } from "./location-input";
import { readErrorMessage } from "./response-error";
import type { TouchedRange } from "./use-calendar-chunks";

export type TravelDraft = {
  travel?: TravelItem;
  origin: string;
  destination: string;
  mode: TravelMode;
  /** 入力欄の形式（YYYY-MM-DDTHH:mm）。 */
  departAt: string;
  arriveAt: string;
  note?: string;
  /**
   * 元になった予定。復路の起点（予定の終了時刻）と、移動と予定の紐づけに使う。
   * 「＋」から作った移動には無く、そのときは復路も作らない（帰りの起点が決まらないため）。
   */
  linkedEvent?: { id: string; calendarId: string; endAt: string } | null;
  /** 往復を作るかの初期値。設定の既定値が入る。 */
  roundTrip?: boolean;
};

/**
 * 移動の入力欄（docs/spec.md §29）。ダイアログの枠と種類の切り替えは ItemDialog が持つ。
 *
 * 出発地・目的地は予定の「場所」欄と同じ入力を使う。候補の一次情報源はNotionの場所DBで、
 * 移動のためにもう1つ候補の置き場所を作らない。
 */
export function TravelForm({
  draft,
  placeCatalog,
  timeZone,
  onSaved,
}: {
  draft: TravelDraft;
  /** 出発地・目的地の入力候補。Notionの場所DBに登録済みのもの。 */
  placeCatalog: PlaceCatalog;
  timeZone: string;
  onSaved: (touched: TouchedRange[] | null) => void;
}) {
  const editing = draft.travel;

  const [origin, setOrigin] = useState(draft.origin);
  const [destination, setDestination] = useState(draft.destination);
  const [mode, setMode] = useState<TravelMode>(draft.mode);
  const [departAt, setDepartAt] = useState(draft.departAt);
  const [arriveAt, setArriveAt] = useState(draft.arriveAt);
  const [note, setNote] = useState(draft.note ?? "");
  // 所要時間をAIから入れたかどうか。目安であることを保存先にも残す。
  const [estimated, setEstimated] = useState(editing?.estimated ?? false);
  const [roundTrip, setRoundTrip] = useState(Boolean(draft.roundTrip && draft.linkedEvent));

  const [estimates, setEstimates] = useState<TravelEstimate[] | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 保存はできたが、Googleカレンダーへ書き出せなかったとき。黙って閉じると気付けない。
  const [exportNotice, setExportNotice] = useState<{ message: string; touched: TouchedRange[] } | null>(
    null,
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const offline = useOffline();

  const rangeError = (() => {
    if (!departAt || !arriveAt) return "出発時刻と到着時刻を入力してください。";
    return arriveAt <= departAt ? "到着時刻が出発時刻より後になるようにしてください。" : null;
  })();

  const inputError =
    rangeError ??
    (origin.trim() && destination.trim() ? null : "出発地と目的地を入力してください。");

  /** 所要時間の候補を選んだとき。到着時刻は動かさず、そこから出発時刻を逆算する。 */
  const applyEstimate = (estimate: TravelEstimate) => {
    setMode(estimate.mode);
    setEstimated(true);
    setEstimates(null);

    if (!arriveAt) return;
    const arrive = new Date(`${arriveAt}:00Z`);
    if (Number.isNaN(arrive.getTime())) return;
    setDepartAt(new Date(arrive.getTime() - estimate.minutes * 60_000).toISOString().slice(0, 16));
  };

  const askEstimate = async () => {
    setEstimating(true);
    setError(null);
    try {
      const response = await fetch("/api/travels/estimate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: origin.trim(), destination: destination.trim(), mode }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "所要時間を調べられませんでした。"));
        return;
      }
      const body = (await response.json()) as { estimates: TravelEstimate[] };
      setEstimates(body.estimates);
    } catch {
      setError("所要時間を調べられませんでした。");
    } finally {
      setEstimating(false);
    }
  };

  const save = async () => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const departIso = localInputToIso(departAt, timeZone);
      const arriveIso = localInputToIso(arriveAt, timeZone);

      // 復路は予定の終了時刻に出発し、行きと同じだけかかるものとして置く。
      const durationMs = new Date(arriveIso).getTime() - new Date(departIso).getTime();
      const returnTrip =
        roundTrip && draft.linkedEvent
          ? {
              departAt: draft.linkedEvent.endAt,
              arriveAt: new Date(new Date(draft.linkedEvent.endAt).getTime() + durationMs).toISOString(),
            }
          : null;

      const payload = {
        origin: origin.trim(),
        destination: destination.trim(),
        mode,
        departAt: departIso,
        arriveAt: arriveIso,
        note: note.trim() || null,
        estimated,
        ...(editing
          ? {}
          : {
              linkedEventId: draft.linkedEvent?.id ?? null,
              linkedCalendarId: draft.linkedEvent?.calendarId ?? null,
              returnTrip,
            }),
      };

      const response = await fetch(
        editing ? `/api/travels/${encodeURIComponent(editing.id)}` : "/api/travels",
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

      const body = (await response.json()) as { exports?: { status: string; reason?: string }[] };

      const touched: TouchedRange[] = [{ start: departIso, end: arriveIso }];
      if (returnTrip) touched.push({ start: returnTrip.departAt, end: returnTrip.arriveAt });
      if (editing) touched.push({ start: editing.start, end: editing.end });

      const message = exportWarning(body.exports ?? []);
      if (message) {
        // 移動そのものは保存できている。閉じてよいことも伝えたうえで理由を残す。
        setExportNotice({ message, touched });
        return;
      }

      onSaved(touched);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {editing && confirmingDelete && (
        <DeleteItemDialog
          item={{ kind: "travel", travel: editing }}
          onCancel={() => setConfirmingDelete(false)}
          onDeleted={onSaved}
        />
      )}

      <div className="flex min-w-0 flex-col gap-4">
        <LocationInput
          id="travel-origin"
          label="出発地"
          value={origin}
          onChange={setOrigin}
          places={placeCatalog.places}
          eventTitle={destination}
          placeDatabaseReady={placeCatalog.ready}
        />

        <LocationInput
          id="travel-destination"
          label="目的地"
          value={destination}
          onChange={setDestination}
          places={placeCatalog.places}
          eventTitle={destination}
          placeDatabaseReady={placeCatalog.ready}
        />

        <div className="flex flex-col gap-2">
          <span className="type-label-small px-1 text-on-surface-variant">交通手段</span>
          <div className="flex flex-wrap gap-2">
            {TRAVEL_MODES.map((option) => (
              <Button
                key={option}
                type="button"
                variant={option === mode ? "secondary" : "outline"}
                size="sm"
                className={cn(
                  "rounded-full",
                  option === mode && "bg-travel-container text-on-travel-container",
                )}
                onClick={() => setMode(option)}
              >
                {TRAVEL_MODE_LABELS[option]}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-2">
          <DateTimeInput
            id="travel-depart"
            dateLabel="出発日"
            timeLabel="出発時刻"
            value={departAt}
            onChange={setDepartAt}
          />
          <DateTimeInput
            id="travel-arrive"
            dateLabel="到着日"
            timeLabel="到着時刻"
            value={arriveAt}
            onChange={setArriveAt}
          />
        </div>

        {/* 所要時間は押したときだけ調べる。入力のたびに呼ぶと、打っている途中の
            文字列で何度も問い合わせることになる（場所の「AIに聞く」と同じ）。 */}
        <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
          {estimates === null ? (
            <>
              <p className="text-xs text-muted-foreground">
                所要時間はAIによる目安です。時刻表や道路状況は見ていません。
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={estimating || !origin.trim() || !destination.trim()}
                onClick={askEstimate}
              >
                <Route className="size-4" />
                {estimating ? "調べています…" : "所要時間を調べる"}
              </Button>
            </>
          ) : estimates.length === 0 ? (
            <>
              <p className="text-xs text-muted-foreground">
                この区間の所要時間は分かりませんでした。時刻を直接入力してください。
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => setEstimates(null)}
              >
                戻る
              </Button>
            </>
          ) : (
            <ul className="flex flex-col gap-1">
              {estimates.map((estimate) => (
                <li key={estimate.mode}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-muted"
                    onClick={() => applyEstimate(estimate)}
                  >
                    <span className="shrink-0 rounded-full bg-travel-container px-2 py-0.5 text-[11px] font-semibold text-on-travel-container">
                      {TRAVEL_MODE_LABELS[estimate.mode]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {estimate.detail ?? `${origin.trim()} → ${destination.trim()}`}
                    </span>
                    <span className="shrink-0 text-sm font-semibold">{estimate.minutes}分</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 往復は元になった予定があるときだけ。単独の移動では帰りの起点が決まらない。 */}
        {!editing && draft.linkedEvent && (
          <label className="-my-1 flex min-h-11 items-center gap-3 px-4 text-base select-none md:text-sm">
            <Checkbox checked={roundTrip} onCheckedChange={(v) => setRoundTrip(v === true)} />
            帰りの移動も作る（予定の終了時刻に出発）
          </label>
        )}

        <Textarea
          id="travel-note"
          label="メモ"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {inputError && <p className="text-sm text-destructive">{inputError}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {exportNotice && <p className="text-sm text-on-surface-variant">{exportNotice.message}</p>}
      </div>

      {/* 書き出しの報せを出している間は、閉じる以外にすることが無い（移動そのものは保存済み）。 */}
      {exportNotice ? (
        <ItemFormActions saveLabel="閉じる" onSave={() => onSaved(exportNotice.touched)} />
      ) : (
        <ItemFormActions
          saveDisabled={busy || offline || inputError !== null}
          onSave={save}
          onDelete={editing ? () => setConfirmingDelete(true) : undefined}
          deleteDisabled={busy || offline}
        />
      )}
    </>
  );
}

/** Googleへ書き出せなかった理由。移動そのものは保存できているため、断りではなく報せとして出す。 */
function exportWarning(exports: { status: string; reason?: string }[]): string | null {
  if (exports.some((result) => result.status === "failed")) {
    return "移動は保存しましたが、Googleカレンダーへ書き出せませんでした。もう一度保存すると書き出しをやり直します。";
  }
  if (exports.some((result) => result.reason === "write_disabled")) {
    return "移動は保存しましたが、書き出し先のカレンダーが使用しない設定のため、Googleカレンダーには出ません。設定 ▸ 移動 で書き出し先を確認してください。";
  }
  if (exports.some((result) => result.reason === "no_calendar")) {
    return "移動は保存しましたが、書き出し先のカレンダーが無いためGoogleカレンダーには出ません。設定 ▸ Google Calendar でカレンダーを接続してください。";
  }
  return null;
}

/** 編集用の初期値。ISO 8601 を入力欄の形式へ直す。 */
export function toTravelDraft(travel: TravelItem, timeZone: string): TravelDraft {
  return {
    travel,
    origin: travel.origin,
    destination: travel.destination,
    mode: travel.mode,
    departAt: isoToLocalInput(travel.start, timeZone),
    arriveAt: isoToLocalInput(travel.end, timeZone),
    note: travel.note ?? "",
  };
}
