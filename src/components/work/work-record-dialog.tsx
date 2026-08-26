"use client";

import { useState } from "react";
import { useOffline } from "next/offline";
import { Trash2 } from "lucide-react";

import { readErrorMessage } from "@/components/calendar/response-error";
import { ItemFormActions } from "@/components/calendar/item-form-actions";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { tagChipClass } from "@/components/tags/tag-color";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ANNUAL_LEAVE_OPTIONS } from "@/services/notion/work-database";
import type { TagOption } from "@/services/notion/tag-options";
import {
  annualLeaveDays,
  isTripPlace,
  WORK_TODO_LABELS,
  type WorkCapabilities,
  type WorkRecordItem,
} from "@/types/work";

/** 記録の種類。同時には立てられないため、スイッチではなく3択で持つ。 */
export type WorkKind = "work" | "trip" | "leave";

const KIND_LABELS: Record<WorkKind, string> = {
  work: "勤務",
  trip: "出張",
  leave: "年休",
};

/** 開くときに渡す下書き。新規はその日から、編集は既存の記録から始める。 */
export type WorkDraft =
  | { mode: "create"; startDate: string; kind: WorkKind }
  | { mode: "edit"; record: WorkRecordItem };

function kindOf(record: WorkRecordItem): WorkKind {
  if (record.annualLeave) return "leave";
  return record.businessTrip ? "trip" : "work";
}

/**
 * 勤務場所・出張・年休の入力（docs/spec.md §34）。
 *
 * 3つを1つのダイアログの中で切り替える。押す前に種類を決めさせると、入力の途中で違うと
 * 気付いたときに閉じて選び直すことになるため（追加UIと同じ考え方）。スイッチを種類の数だけ
 * 並べないのは、同時に立てられない3つが並ぶと、どれを消せばよいのかが画面から読めないため。
 */
export function WorkRecordDialog({
  draft,
  placeOptions,
  tripPlaces,
  capabilities,
  onClose,
  onSaved,
}: {
  draft: WorkDraft;
  placeOptions: TagOption[];
  /** 出張扱いにする勤務場所の名前（docs/spec.md §34）。 */
  tripPlaces: string[];
  capabilities: WorkCapabilities;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = draft.mode === "edit" ? draft.record : null;

  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [place, setPlace] = useState(existing?.place ?? placeOptions[0]?.name ?? "");
  // 新規のときの種類はdraftの指定どおり。ここで場所から出張の既定を立てると、
  // 日の行を押しただけの下書きが出張として開くことがある。出張扱い（docs/spec.md §34）が
  // 効くのは、場所のチップを押して選んだときだけにする。
  const [kind, setKind] = useState<WorkKind>(
    draft.mode === "edit" ? kindOf(draft.record) : draft.kind,
  );
  const [annualLeave, setAnnualLeave] = useState<string>(
    existing?.annualLeave ?? ANNUAL_LEAVE_OPTIONS[0].name,
  );
  const [destination, setDestination] = useState(existing?.businessTrip ? existing.title : "");

  /**
   * 出張の種類選択を手で操作したか。
   *
   * 触るまでは勤務場所の既定へ追従し、一度触ったあとは場所を選び直しても動かさない。
   * 選んだつもりの状態が黙って書き換わらないようにするため（繰り返しの曜日と同じ考え方）。
   * すでに出張として保存されている記録は、場所とは無関係にそう決められたものなので、
   * 開いた時点で「触った」扱いにして追従させない。
   */
  const [tripTouched, setTripTouched] = useState(
    draft.mode === "edit" &&
      draft.record.businessTrip &&
      !isTripPlace(tripPlaces, draft.record.place),
  );

  const [startDate, setStartDate] = useState(
    draft.mode === "edit" ? draft.record.startDate : draft.startDate,
  );
  const [endDate, setEndDate] = useState(existing?.endDate ?? "");
  const [memo, setMemo] = useState(existing?.memo ?? "");
  const [preApplied, setPreApplied] = useState(existing?.preApplied ?? false);
  const [postRegistered, setPostRegistered] = useState(existing?.postRegistered ?? false);

  const offline = useOffline();

  const businessTrip = kind === "trip";
  const isLeave = kind === "leave";
  // 半休の日は残り半日どこで働いたかも要る（勤怠の提出で使う）。全休の日は入る値が無い。
  const halfDay = isLeave && annualLeaveDays(annualLeave) < 1;
  // 期間を持てるのは出張と全休の年休だけ。半休は単日に限る（半日ずつ2日ぶんという形が無い）。
  const spanned = businessTrip || (isLeave && !halfDay);
  // 使える種類だけを出す。揃っていないプロパティの種類を出すと、押しても保存されない道が残る。
  const kinds: WorkKind[] = [
    "work",
    ...(capabilities.businessTrip ? (["trip"] as const) : []),
    ...(capabilities.annualLeave ? (["leave"] as const) : []),
  ];

  /** 種類を手で選ぶ。以降は場所を選び直しても出張扱いの既定を追従させない。 */
  const chooseKind = (next: WorkKind) => {
    setTripTouched(true);
    setKind(next);
  };

  /**
   * 勤務場所を選ぶ。出張扱いの場所なら、種類と行き先まで出張へ合わせる。
   * 半休の残り半日の勤務場所を選ぶ操作では、種類（年休）を動かさない。
   * 行き先を上書きするのは、空のときと前の場所の名前がそのまま残っているときだけ。
   */
  const choosePlace = (name: string) => {
    setPlace(name);
    if (isLeave || tripTouched || !capabilities.businessTrip) return;

    const trip = isTripPlace(tripPlaces, name);
    setKind(trip ? "trip" : "work");
    if (trip && (!destination.trim() || destination === place)) setDestination(name);
  };

  const close = () => {
    setOpen(false);
    setTimeout(onClose, 150);
  };

  const finish = () => {
    setOpen(false);
    setTimeout(onSaved, 150);
  };

  const send = async (path: string, init: RequestInit, fallback: string) => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, init);
      if (!response.ok) {
        setError(await readErrorMessage(response, fallback));
        return;
      }
      finish();
    } catch {
      setError(fallback);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!startDate) {
      setError("日付を入力してください。");
      return;
    }
    if (businessTrip && !destination.trim()) {
      setError("行き先を入力してください。");
      return;
    }
    if (halfDay && !place) {
      setError("残り半日の勤務場所を選んでください。");
      return;
    }
    if (!businessTrip && !isLeave && !place) {
      setError("勤務場所を選んでください。");
      return;
    }

    // 通常の勤務は勤務場所の名前をそのままタイトルにする。Notionの一覧で開かずに読めるようにし、
    // 入力の欄も1つ減らす。出張は行き先が、年休は区分がタイトルになる。
    const title = isLeave ? `年休（${annualLeave}）` : businessTrip ? destination.trim() : place;
    const body = {
      title,
      startDate,
      endDate: spanned && endDate ? endDate : startDate,
      // 全休の日に勤務場所は入らない。半休の日は残り半日の勤務場所を持つ。
      place: isLeave ? (halfDay ? place || null : null) : businessTrip ? place || null : place,
      ...(capabilities.businessTrip ? { businessTrip } : {}),
      ...(capabilities.annualLeave ? { annualLeave: isLeave ? annualLeave : null } : {}),
      ...(capabilities.approval && businessTrip ? { preApplied, postRegistered } : {}),
      ...(capabilities.annualLeave && isLeave ? { preApplied } : {}),
      ...(capabilities.memo ? { memo: memo.trim() || null } : {}),
    };

    if (existing) {
      await send(
        `/api/work/records/${existing.id}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        "勤務記録を保存できませんでした。",
      );
      return;
    }

    await send(
      "/api/work/records",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      "勤務記録を保存できませんでした。",
    );
  };

  const remove = async () => {
    if (!existing) return;
    await send(
      `/api/work/records/${existing.id}`,
      { method: "DELETE" },
      "勤務記録を削除できませんでした。",
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent position="bottom" className="max-h-[85dvh] gap-3 overflow-y-auto">
        <DialogTitle>{kind === "work" ? "勤務場所" : KIND_LABELS[kind]}</DialogTitle>
        <DialogDescription className="sr-only">
          勤務場所・出張・年休の登録。出張では事前申請と事後登録、年休では事前申請の状況も持てます。
        </DialogDescription>

        {error && (
          <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container">
            {error}
          </p>
        )}

        {/* 種類。同時に立てられない3つなので、スイッチを並べず1つの並びから選ばせる。 */}
        {kinds.length > 1 && (
          <div
            role="radiogroup"
            aria-label="記録の種類"
            className={cn(
              "grid overflow-hidden rounded-full border border-outline",
              // 使える種類の数で列を決める。3列に固定すると、年休だけを足したDBで空の枠が並ぶ。
              kinds.length === 3 ? "grid-cols-3" : "grid-cols-2",
            )}
          >
            {kinds.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                onClick={() => chooseKind(option)}
                className={cn(
                  "type-label-large py-2 text-center transition-colors",
                  kind === option
                    ? "bg-secondary-container font-bold text-on-secondary-container"
                    : "text-on-surface-variant hover:bg-on-surface/8",
                )}
              >
                {KIND_LABELS[option]}
              </button>
            ))}
          </div>
        )}

        {isLeave && (
          <div className="flex flex-col gap-2">
            <span className="type-label-medium text-on-surface-variant">区分</span>
            <div className="flex flex-wrap gap-2">
              {ANNUAL_LEAVE_OPTIONS.map((option) => (
                <button
                  key={option.name}
                  type="button"
                  aria-pressed={annualLeave === option.name}
                  onClick={() => setAnnualLeave(option.name)}
                  className={cn(
                    "type-label-large rounded-full border px-4 py-2 transition-colors",
                    annualLeave === option.name
                      ? "border-transparent bg-tertiary-container font-bold text-on-tertiary-container"
                      : "border-outline text-on-surface hover:bg-on-surface/8",
                  )}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 全休の日に勤務場所は入らない。半休の日は残り半日ぶんを選ばせる。 */}
        {placeOptions.length > 0 && (!isLeave || halfDay) && (
          <div className="flex flex-col gap-2">
            <span className="type-label-medium text-on-surface-variant">
              {halfDay ? "残り半日の勤務場所" : "勤務場所"}
            </span>
            <div className="flex flex-wrap gap-2">
              {placeOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={place === option.name}
                  onClick={() => choosePlace(option.name)}
                  className={cn(
                    "type-label-large rounded-full border px-4 py-2 transition-colors",
                    place === option.name
                      ? cn("border-transparent font-bold", tagChipClass(option.color))
                      : "border-outline text-on-surface hover:bg-on-surface/8",
                  )}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {businessTrip && (
          <Input
            id="work-destination"
            label="行き先"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          />
        )}

        <div className={cn("grid gap-2", spanned && "grid-cols-2")}>
          <Input
            id="work-start-date"
            label={spanned ? "開始日" : "日付"}
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          {/* 終了日は出張と全休の年休だけ。通常の勤務と半休は1日1件で、期間を持たせる意味が無い。 */}
          {spanned && (
            <Input
              id="work-end-date"
              label="終了日"
              type="date"
              value={endDate || startDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          )}
        </div>

        {/* 年休が持つのは事前申請だけ。休んだことを後から届け出る手続きは無い。 */}
        {isLeave && capabilities.annualLeave && (
          <label className="flex items-center gap-3 py-1.5">
            <Checkbox
              checked={preApplied}
              onCheckedChange={(next) => setPreApplied(next === true)}
            />
            <span className="type-body-medium">{WORK_TODO_LABELS.preApplied}を済ませた</span>
          </label>
        )}

        {businessTrip && capabilities.approval && (
          <div className="flex flex-col gap-1">
            {(["preApplied", "postRegistered"] as const).map((todo) => {
              const checked = todo === "preApplied" ? preApplied : postRegistered;
              const setChecked = todo === "preApplied" ? setPreApplied : setPostRegistered;
              return (
                <label key={todo} className="flex items-center gap-3 py-1.5">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) => setChecked(next === true)}
                  />
                  <span className="type-body-medium">
                    {WORK_TODO_LABELS[todo]}を済ませた
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {capabilities.memo && (
          <Textarea
            id="work-memo"
            label="メモ"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
          />
        )}

        {/* 削除は必ず確認を挟む。押し間違えても画面上に戻す手立てが無いため（docs/spec.md §15）。
            ただしNotionのゴミ箱には残るので、確認の文にもそれを書く。 */}
        {confirming ? (
          <div className="flex flex-col gap-2 rounded-xl bg-error-container p-3 text-on-error-container">
            <p className="type-body-small">
              この記録を削除します。Notionのゴミ箱へ移るため、Notion側から戻せます。
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                className="flex-1"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                やめる
              </Button>
              <Button variant="destructive" className="flex-1" disabled={busy} onClick={remove}>
                <Trash2 className="size-4" />
                削除する
              </Button>
            </div>
          </div>
        ) : (
          <ItemFormActions
            saveDisabled={busy || offline}
            onSave={save}
            onDelete={existing ? () => setConfirming(true) : undefined}
            deleteDisabled={busy || offline}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
