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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { TagOption } from "@/services/notion/tag-options";
import { WORK_TODO_LABELS, type WorkCapabilities, type WorkRecordItem } from "@/types/work";

/** 開くときに渡す下書き。新規はその日から、編集は既存の記録から始める。 */
export type WorkDraft =
  | { mode: "create"; startDate: string; businessTrip: boolean }
  | { mode: "edit"; record: WorkRecordItem };

/**
 * 勤務場所・出張の入力（docs/spec.md §34）。
 *
 * 通常の勤務と出張を1つのダイアログの中で切り替える。押す前に種類を決めさせると、
 * 入力の途中で違うと気付いたときに閉じて選び直すことになるため（追加UIと同じ考え方）。
 */
export function WorkRecordDialog({
  draft,
  placeOptions,
  capabilities,
  onClose,
  onSaved,
}: {
  draft: WorkDraft;
  placeOptions: TagOption[];
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
  const [businessTrip, setBusinessTrip] = useState(
    draft.mode === "edit" ? draft.record.businessTrip : draft.businessTrip,
  );
  const [destination, setDestination] = useState(existing?.businessTrip ? existing.title : "");
  const [startDate, setStartDate] = useState(
    draft.mode === "edit" ? draft.record.startDate : draft.startDate,
  );
  const [endDate, setEndDate] = useState(existing?.endDate ?? "");
  const [memo, setMemo] = useState(existing?.memo ?? "");
  const [preApplied, setPreApplied] = useState(existing?.preApplied ?? false);
  const [postRegistered, setPostRegistered] = useState(existing?.postRegistered ?? false);

  const offline = useOffline();

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
    if (!businessTrip && !place) {
      setError("勤務場所を選んでください。");
      return;
    }

    // 通常の勤務は勤務場所の名前をそのままタイトルにする。Notionの一覧で開かずに読めるようにし、
    // 入力の欄も1つ減らす。出張は行き先がタイトルになる。
    const body = {
      title: businessTrip ? destination.trim() : place,
      startDate,
      endDate: businessTrip && endDate ? endDate : startDate,
      place: businessTrip ? place || null : place,
      ...(capabilities.businessTrip ? { businessTrip } : {}),
      ...(capabilities.approval && businessTrip ? { preApplied, postRegistered } : {}),
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
        <DialogTitle>{businessTrip ? "出張" : "勤務場所"}</DialogTitle>
        <DialogDescription className="sr-only">
          勤務場所と出張の登録。出張では事前申請と事後登録の状況も持てます。
        </DialogDescription>

        {error && (
          <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container">
            {error}
          </p>
        )}

        {placeOptions.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="type-label-medium text-on-surface-variant">勤務場所</span>
            <div className="flex flex-wrap gap-2">
              {placeOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={place === option.name}
                  onClick={() => setPlace(option.name)}
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

        {capabilities.businessTrip && (
          <label className="flex items-center gap-3 py-1">
            <Switch checked={businessTrip} onCheckedChange={setBusinessTrip} />
            <span className="type-body-large">出張</span>
            <span className="type-body-small ml-auto text-on-surface-variant">
              事前申請・事後登録の対象にする
            </span>
          </label>
        )}

        {businessTrip && (
          <Input
            id="work-destination"
            label="行き先"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          />
        )}

        <div className={cn("grid gap-2", businessTrip && "grid-cols-2")}>
          <Input
            id="work-start-date"
            label={businessTrip ? "開始日" : "日付"}
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          {/* 終了日は出張のときだけ。通常の勤務は1日1件で、期間を持たせる意味が無い。 */}
          {businessTrip && (
            <Input
              id="work-end-date"
              label="終了日"
              type="date"
              value={endDate || startDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          )}
        </div>

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
