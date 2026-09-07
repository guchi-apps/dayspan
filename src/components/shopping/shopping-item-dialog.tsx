"use client";

import { useMemo, useState } from "react";
import { useOffline } from "next/offline";
import { Check, Plus, Trash2 } from "lucide-react";

import { ItemFormActions } from "@/components/calendar/item-form-actions";
import { createCalendarDateUtils } from "@/components/calendar/item-layout";
import { readErrorMessage } from "@/components/calendar/response-error";
import { OFFLINE_WRITE_MESSAGE } from "@/components/offline/offline-notice";
import { tagChipClass } from "@/components/tags/tag-color";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addDays, parseDateKey, toDateKey } from "@/lib/calendar-range";
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
  timeZone,
  onClose,
  onSaved,
}: {
  draft: ShoppingDraft;
  /** 登録済みのカテゴリ。ここに無い名前も、この画面から足せる。 */
  categoryOptions: TagOption[];
  /**
   * 「今日」「明日」を決めるためのタイムゾーン（`UiSetting.timeZone`）。
   * 端末の時計に任せると、サーバー（UTC）とブラウザ（JST）で日付が食い違う。
   */
  timeZone: string;
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
  const [plannedDate, setPlannedDate] = useState<string | null>(existing?.plannedDate ?? null);

  // 「今日」「明日」の日付は設定タイムゾーンから決める（CLAUDE.md「日付・時刻の解釈」）。
  const { todayKey, tomorrowKey } = useMemo(() => {
    const today = createCalendarDateUtils(timeZone).todayKey();
    return { todayKey: today, tomorrowKey: toDateKey(addDays(parseDateKey(today), 1)) };
  }, [timeZone]);

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

    const body = { name: trimmed, memo: memo.trim() || null, category, priority, plannedDate };

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
          アイテム名・メモ・カテゴリ・購入予定日・優先度を入力します。
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

        {/* 購入予定日（docs/spec.md §36）。「今日買う」「明日買う」がいちばん多い指定なので、
            そこはチップ1つで済ませる。それ以外の日は下の欄で選ぶ。チップと欄はどちらも同じ値を
            指しており、押した値と保存される値が食い違わない。 */}
        <div className="flex flex-col gap-2">
          <span className="type-label-large text-on-surface-variant">購入予定日</span>
          <div className="flex flex-wrap gap-1.5">
            <ChoiceChip selected={plannedDate === null} onClick={() => setPlannedDate(null)}>
              未定
            </ChoiceChip>
            <ChoiceChip
              selected={plannedDate === todayKey}
              onClick={() => setPlannedDate(todayKey)}
            >
              今日
            </ChoiceChip>
            <ChoiceChip
              selected={plannedDate === tomorrowKey}
              onClick={() => setPlannedDate(tomorrowKey)}
            >
              明日
            </ChoiceChip>
          </div>
          {/* 日付の欄には ✕（クリア）を出さない。消す操作は「未定」のチップが受けており、
              欄にも置くと同じことをする出口が2つ並ぶ（CLAUDE.md「入力欄の ✕」）。 */}
          <Input
            label="日付"
            type="date"
            value={plannedDate ?? ""}
            onChange={(event) => setPlannedDate(event.target.value || null)}
          />
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
 * **色を持つのは選ばれているものだけ**にする（issue #570）。以前は逆で、未選択がNotionの
 * タグ色で塗られ、選択中だけが secondary-container だった。色付きが並ぶ中でいちばん色の弱い
 * ものが選択中という並びになり、押した手応えが色に出ない。タスクのタグ選び
 * （`components/tags/tag-picker.tsx` の `TagToggle`）は既にこの規則で、同じ操作の見え方が
 * アプリの中で2通りある状態でもあった。
 *
 * 手掛かりは3つ重ねる。塗り（選んだものだけ色を持つ）、チェック（色を読み分けにくい状況でも
 * 分かる。色だけに意味を持たせない）、輪郭（タグ色の塗りは18%と淡く、塗りだけでは枠が立たない）。
 *
 * タグ色を持たない選択肢（未設定・購入予定日・優先度）は、選択中を secondary-container で塗る。
 */
function ChoiceChip({
  selected,
  colorClass,
  onClick,
  children,
}: {
  selected: boolean;
  /** Notionのタグ色。持たない選択肢では省く。 */
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
        "type-label-large flex items-center gap-1 rounded-full border px-3 py-1 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        selected
          ? cn(
              "border-current font-medium",
              colorClass ?? "bg-secondary-container text-on-secondary-container",
            )
          : "border-outline-variant text-on-surface-variant hover:bg-on-surface/8",
      )}
    >
      {selected && <Check className="size-3.5 shrink-0" aria-hidden />}
      {children}
    </button>
  );
}
