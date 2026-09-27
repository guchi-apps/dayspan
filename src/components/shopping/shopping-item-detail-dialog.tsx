"use client";

import { useState } from "react";
import { useOffline } from "next/offline";
import { ArrowRight, ExternalLink, Heart, Pencil, Trash2 } from "lucide-react";

import { readErrorMessage } from "@/components/calendar/response-error";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
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
import { cn } from "@/lib/utils";
import type { ShoppingItem } from "@/types/shopping";

/** 買い物項目の表示画面。行を押したときは、入力画面へ直行させずここで内容を確認する。 */
export function ShoppingItemDetailDialog({
  item: initialItem,
  readOnly = false,
  onClose,
  onEdit,
  onChanged,
  onDeleted,
}: {
  item: ShoppingItem;
  /** オフライン中も表示はできるが、Notionへ書き込む操作は止める。 */
  readOnly?: boolean;
  onClose: () => void;
  onEdit: (item: ShoppingItem) => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [item, setItem] = useState(initialItem);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const offline = useOffline();
  const writesDisabled = readOnly || offline;

  // 開いたままアンマウントするとRadixの後始末が走らないことがあるため、閉じ切ってから返す。
  const closeThen = (callback: () => void) => {
    setOpen(false);
    setTimeout(callback, 150);
  };
  const close = () => closeThen(onClose);

  const patch = async (
    body: Partial<ShoppingItem>,
    fallback: string,
  ): Promise<boolean> => {
    if (writesDisabled) {
      setError(OFFLINE_WRITE_MESSAGE);
      return false;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/shopping/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        setError(await readErrorMessage(response, fallback));
        return false;
      }
      setItem((current) => ({ ...current, ...body }));
      onChanged();
      return true;
    } catch {
      setError(fallback);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggleBought = (bought: boolean) =>
    patch({ bought }, "購入済みを変更できませんでした。");
  const changeClassification = (wishlisted: boolean) =>
    patch(
      wishlisted
        ? { wishlisted: true, plannedDate: null, bought: false }
        : { wishlisted: false },
      wishlisted
        ? "欲しいものへ変更できませんでした。"
        : "買うものへ変更できませんでした。",
    );

  const remove = async () => {
    if (writesDisabled) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/shopping/${encodeURIComponent(item.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError(await readErrorMessage(response, "削除できませんでした。"));
        return;
      }
      closeThen(onDeleted);
    } catch {
      setError("削除できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const edit = () => closeThen(() => onEdit(item));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {confirmingDelete ? (
          <>
            <DialogHeader>
              <DialogTitle>削除しますか？</DialogTitle>
              <DialogDescription>
                「{item.name}
                」をNotionのゴミ箱へ移します。Notionのゴミ箱から元に戻せます。
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmingDelete(false)}
              >
                やめる
              </Button>
              <Button
                variant="destructive"
                disabled={busy || writesDisabled}
                onClick={remove}
              >
                削除
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="削除"
              className="absolute top-2 right-18"
              disabled={busy || writesDisabled}
              onClick={() => setConfirmingDelete(true)}
            >
              <Trash2 className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="編集"
              className="absolute top-2 right-10"
              disabled={busy || writesDisabled}
              onClick={edit}
            >
              <Pencil className="size-4" />
            </Button>

            <DialogHeader>
              <DialogTitle
                className={cn(
                  "pr-22",
                  item.bought && "text-on-surface-variant line-through",
                )}
              >
                {item.name}
              </DialogTitle>
              <DialogDescription className="sr-only">
                買い物項目の詳細
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-4 text-sm">
              {!item.wishlisted && (
                <label className="-my-1 flex min-h-11 items-center gap-3 px-4 text-base select-none md:text-sm">
                  <Checkbox
                    checked={item.bought}
                    disabled={busy || writesDisabled}
                    onCheckedChange={(value) =>
                      void toggleBought(value === true)
                    }
                  />
                  購入済み
                </label>
              )}
              {writesDisabled && (
                <p className="px-4 text-xs text-on-surface-variant">
                  {OFFLINE_WRITE_MESSAGE}
                </p>
              )}
              <DetailField
                label="分類"
                value={item.wishlisted ? "欲しいもの" : "買うもの"}
              />
              {item.category && (
                <DetailField label="カテゴリ" value={item.category} />
              )}
              {item.priority && (
                <DetailField label="優先度" value={item.priority} />
              )}
              {!item.wishlisted && item.plannedDate && (
                <DetailField
                  label="購入予定日"
                  value={formatDateKey(item.plannedDate)}
                />
              )}
              {item.memo && <DetailField label="メモ" value={item.memo} />}
              <Button
                variant="outline"
                className="mx-4 w-fit"
                disabled={busy || writesDisabled}
                onClick={() => void changeClassification(!item.wishlisted)}
              >
                {item.wishlisted ? (
                  <ArrowRight className="size-4" />
                ) : (
                  <Heart className="size-4" />
                )}
                {item.wishlisted ? "買うものへ" : "欲しいものへ"}
              </Button>
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-4 text-xs text-muted-foreground hover:underline"
                >
                  <ExternalLink className="size-3" />
                  Notionで開く
                </a>
              )}
              {error && (
                <p className="px-4 text-sm text-destructive">{error}</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={close}>
                閉じる
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap">{value}</span>
    </div>
  );
}

function formatDateKey(dateKey: string): string {
  return `${Number(dateKey.slice(5, 7))}月${Number(dateKey.slice(8, 10))}日`;
}
