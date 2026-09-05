"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useOffline } from "next/offline";

import { readErrorMessage } from "@/components/calendar/response-error";
import { ItemFormActions } from "@/components/calendar/item-form-actions";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fiscalYearLabel, normalizeStartMonth } from "@/lib/annual-leave";

/**
 * 年休の付与日数・繰越・年度の開始月を直す（docs/spec.md §34）。
 *
 * 設定画面ではなく、見ている年度の画面から開く。付与日数は年度ごとに違い、直したくなるのは
 * その年度を見ているときだから。開始月だけは全年度に効くので、そう書き添える。
 */
export function AnnualLeaveGrantDialog({
  fiscalYear,
  startMonth,
  grantedDays,
  carriedOverDays,
  onClose,
}: {
  fiscalYear: number;
  startMonth: number;
  /** その年度の付与日数。まだ入れていない年度は null（欄は空で開く）。 */
  grantedDays: number | null;
  carriedOverDays: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const offline = useOffline();

  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [granted, setGranted] = useState(grantedDays === null ? "" : String(grantedDays));
  const [carried, setCarried] = useState(carriedOverDays === 0 ? "" : String(carriedOverDays));
  const [month, setMonth] = useState(String(startMonth));

  const close = () => {
    setOpen(false);
    onClose();
  };

  const save = async () => {
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    // 空欄は0として扱う（繰越が無い年度でわざわざ0を打たせない）。0.5刻みの判定は
    // サーバー側にも置いてあり、ここはその場で理由を出すためのもの。
    const grantedDaysValue = granted.trim() === "" ? 0 : Number(granted);
    const carriedDaysValue = carried.trim() === "" ? 0 : Number(carried);
    const monthValue = Number(month);

    if (!isDays(grantedDaysValue) || !isDays(carriedDaysValue)) {
      setError("付与日数・繰越日数は0〜400の範囲で、0.5日単位で入力してください。");
      return;
    }
    if (!Number.isInteger(monthValue) || monthValue < 1 || monthValue > 12) {
      setError("年度の開始月は1〜12で入力してください。");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/work/leave-grant", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fiscalYear,
          grantedDays: grantedDaysValue,
          carriedOverDays: carriedDaysValue,
          fiscalYearStartMonth: monthValue,
        }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "付与日数を保存できませんでした。"));
        return;
      }
      // 開始月を変えると年度の期間そのものが動くため、URLの年度はそのままに取り直す。
      startTransition(() => router.refresh());
      close();
    } catch {
      setError("付与日数を保存できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const label = fiscalYearLabel(fiscalYear, normalizeStartMonth(Number(month)));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent position="bottom" className="max-h-[85dvh] gap-3 overflow-y-auto">
        <DialogTitle>{label}の年休</DialogTitle>
        <DialogDescription className="sr-only">
          付与日数・繰越日数と年度の開始月を設定します。
        </DialogDescription>

        {error && (
          <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container">
            {error}
          </p>
        )}

        <Input
          id="leave-granted"
          label="この年度に付与された日数"
          type="number"
          inputMode="decimal"
          step="0.5"
          min="0"
          value={granted}
          onChange={(event) => setGranted(event.target.value)}
        />

        <Input
          id="leave-carried"
          label="前年度からの繰越"
          type="number"
          inputMode="decimal"
          step="0.5"
          min="0"
          value={carried}
          onChange={(event) => setCarried(event.target.value)}
        />

        <Input
          id="leave-start-month"
          label="年度の開始月"
          type="number"
          inputMode="numeric"
          step="1"
          min="1"
          max="12"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
        />
        <p className="type-body-small text-on-surface-variant">
          開始月はすべての年度に効きます。変えると、これまでに入れた付与日数が指す期間も一緒に動きます。
        </p>

        <ItemFormActions saveDisabled={busy || offline} onSave={save} />
      </DialogContent>
    </Dialog>
  );
}

/** 付与・繰越として受け付ける日数か。半休が0.5日なので0.5刻みまで受ける。 */
function isDays(value: number): boolean {
  return (
    Number.isFinite(value) && value >= 0 && value <= 400 && Math.round(value * 2) === value * 2
  );
}
