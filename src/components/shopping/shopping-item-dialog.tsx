"use client";

import { useState } from "react";
import { useOffline } from "next/offline";
import { Plus, Trash2 } from "lucide-react";

import { ItemFormActions } from "@/components/calendar/item-form-actions";
import { readErrorMessage } from "@/components/calendar/response-error";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { tagChipClass } from "@/components/tags/tag-color";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { TagOption } from "@/services/notion/tag-options";
import { SHOPPING_PRIORITIES, type ShoppingItem, type ShoppingPriority } from "@/types/shopping";

/** 開くときに渡す下書き。新規は選んでいるカテゴリから、編集は既存の項目から始める。 */
export type ShoppingDraft =
  | { mode: "create"; category: string | null }
  | { mode: "edit"; item: ShoppingItem };

/**
 * 買い物リストの項目の入力（docs/spec.md §36）。
 *
 * 予定・タスク・日付リマインドの入力（`ItemDialog`）へは混ぜない。あちらは日時の欄が主で、
 * 種類を切り替えても入力する軸は変わらないのに対し、買い物の項目は日付も時刻も持たない。
 * 同じダイアログに入れると、切り替えたときに欄がまるごと入れ替わる。
 */
export function ShoppingItemDialog({
  draft,
  categoryOptions,
  onClose,
  onSaved,
}: {
  draft: ShoppingDraft;
  /** 登録済みのカテゴリ。ここに無い名前も、この画面から足せる。 */
  categoryOptions: TagOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = draft.mode === "edit" ? draft.item : null;

  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [name, setName] = useState(existing?.name ?? "");
  const [memo, setMemo] = useState(existing?.memo ?? "");
  const [category, setCategory] = useState<string | null>(
    draft.mode === "edit" ? draft.item.category : draft.category,
  );
  const [priority, setPriority] = useState<ShoppingPriority>(existing?.priority ?? null);

  // 新しいカテゴリの追加。入力の途中で思いついた売り場を、設定画面へ回らずに足せるようにする
  // （タスクのタグ・場所の登録と同じ理由）。押されるまで欄は出さない。
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [categories, setCategories] = useState(categoryOptions);

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
    const trimmed = name.trim();
    if (!trimmed) {
      setError("アイテム名を入力してください。");
      return;
    }

    const body = { name: trimmed, memo: memo.trim() || null, category, priority };

    if (existing) {
      await send(
        `/api/shopping/${existing.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        "保存できませんでした。",
      );
      return;
    }

    await send(
      "/api/shopping",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      "保存できませんでした。",
    );
  };

  const remove = async () => {
    if (!existing) return;
    await send(`/api/shopping/${existing.id}`, { method: "DELETE" }, "削除できませんでした。");
  };

  /**
   * カテゴリを1つ足して、そのまま選んだ状態にする。
   *
   * 足しただけで選ばれないと、続けてチップを押す手間が増える。足す理由はいま入れている
   * 項目に付けることなので、選ぶところまでを1つの操作にする。
   */
  const addCategory = async () => {
    const trimmed = newCategory.trim();
    if (!trimmed) return;
    if (offline) {
      setError(OFFLINE_WRITE_MESSAGE);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/notion/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "shopping", name: trimmed }),
      });
      if (!response.ok) {
        setError(await readErrorMessage(response, "カテゴリを追加できませんでした。"));
        return;
      }
      const body = (await response.json()) as { options?: TagOption[] };
      setCategories(body.options ?? categories);
      setCategory(trimmed);
      setNewCategory("");
      setAddingCategory(false);
    } catch {
      setError("カテゴリを追加できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent position="bottom" className="max-h-[85dvh] gap-3 overflow-y-auto">
        <DialogTitle>{existing ? "買い物リストの項目" : "買い物リストに追加"}</DialogTitle>
        <DialogDescription className="sr-only">
          アイテム名・メモ・カテゴリ・優先度を入力します。
        </DialogDescription>

        {error && (
          <p className="type-body-small rounded-xl bg-error-container px-4 py-3 text-on-error-container">
            {error}
          </p>
        )}

        <Input
          label="アイテム名"
          value={name}
          autoFocus={!existing}
          onChange={(event) => setName(event.target.value)}
        />

        <Textarea
          label="メモ"
          rows={2}
          placeholder="2本・低脂肪じゃないほう"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
        />

        <div className="flex flex-col gap-2">
          <span className="type-label-large text-on-surface-variant">カテゴリ</span>
          <div className="flex flex-wrap gap-1.5">
            <ChoiceChip selected={category === null} onClick={() => setCategory(null)}>
              未設定
            </ChoiceChip>
            {categories.map((option) => (
              <ChoiceChip
                key={option.id}
                selected={category === option.name}
                colorClass={tagChipClass(option.color)}
                onClick={() => setCategory(option.name)}
              >
                {option.name}
              </ChoiceChip>
            ))}
            {/* 一覧に無い名前が付いたままの項目を編集したとき、その名前も選べる状態で出す。
                出さないと、保存し直しただけでカテゴリが外れる。 */}
            {category !== null && !categories.some((option) => option.name === category) && (
              <ChoiceChip selected onClick={() => setCategory(category)}>
                {category}
              </ChoiceChip>
            )}

            {!addingCategory && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 rounded-full px-2.5"
                disabled={busy || offline}
                onClick={() => setAddingCategory(true)}
              >
                <Plus className="size-3.5" />
                カテゴリを追加
              </Button>
            )}
          </div>

          {addingCategory && (
            <div className="flex items-end gap-2">
              <Input
                label="新しいカテゴリ"
                className="flex-1"
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
              />
              <Button
                size="sm"
                className="h-10"
                disabled={busy || !newCategory.trim()}
                onClick={addCategory}
              >
                追加
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-10"
                disabled={busy}
                onClick={() => {
                  setAddingCategory(false);
                  setNewCategory("");
                }}
              >
                やめる
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="type-label-large text-on-surface-variant">優先度</span>
          <div className="flex flex-wrap gap-1.5">
            <ChoiceChip selected={priority === null} onClick={() => setPriority(null)}>
              未設定
            </ChoiceChip>
            {SHOPPING_PRIORITIES.map((value) => (
              <ChoiceChip
                key={value}
                selected={priority === value}
                onClick={() => setPriority(value)}
              >
                {value}
              </ChoiceChip>
            ))}
          </div>
        </div>

        {/* 削除は必ず確認を挟む（docs/spec.md §7）。押し間違えても画面上に戻す手立てが無い。
            Notionのゴミ箱からは戻せるため、その旨も出す。 */}
        {confirming ? (
          <div className="flex flex-col gap-3 pt-2">
            <p className="type-body-medium">
              「{existing?.name}」を削除しますか？Notionのゴミ箱からは元に戻せます。
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
            saveDisabled={busy || offline || !name.trim()}
            onSave={save}
            onDelete={existing ? () => setConfirming(true) : undefined}
            deleteDisabled={busy || offline}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * 選択肢1つぶんのチップ。
 *
 * カテゴリはNotionの色をそのまま帯びるが、選ばれているものは色よりも「いま選ばれている」
 * ことが先に読めないといけない。選択中は配色を secondary-container で統一する。
 */
function ChoiceChip({
  selected,
  colorClass,
  onClick,
  children,
}: {
  selected: boolean;
  colorClass?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "type-label-large rounded-full border px-3 py-1 transition-colors",
        selected
          ? "border-transparent bg-secondary-container font-bold text-on-secondary-container"
          : cn("border-outline-variant text-on-surface-variant hover:bg-on-surface/8", colorClass),
      )}
    >
      {children}
    </button>
  );
}
