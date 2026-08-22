"use client";

import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * 入力ダイアログの下端に置くボタン（docs/spec.md §15）。
 *
 * 置くのは保存と削除の2つだけで、どちらも全幅で縦に並べる（上が保存、下が削除）。
 * 「やめる」を持たないのは、右上の ✕・画面外のタップ・Esc がすでに同じことをするため。
 * 出口をもう1つ並べても押す先が増えるだけで、戻れる道は増えない。
 *
 * 削除に塗りを持たせないのは、保存との差を塗りの有無で付けるため。並べたときに
 * 目が向く先が保存側になり、押し間違いの向きもそちらへ寄る。
 *
 * 外枠に DialogFooter を使わないのは、その基底が
 * `flex-col-reverse ... sm:flex-row sm:justify-end` で、縦積み・全幅にするには
 * 3つとも className で打ち消すことになり潰し合うため（ダイアログの位置を className では
 * なく `position` で選んでいるのと同じ理由）。余白 `pt-2` はそのまま引き継ぐ。
 */
export function ItemFormActions({
  saveLabel = "保存",
  saveDisabled = false,
  onSave,
  onDelete,
  deleteDisabled = false,
  children,
}: {
  /** 保存のラベル。報せを閉じるだけの場面では「閉じる」に差し替える。 */
  saveLabel?: string;
  saveDisabled?: boolean;
  onSave: () => void;
  /**
   * 削除。作成のときは渡さない（行ごと出さない）。
   * 押した先で確認を挟むのは呼び出し側の役目（docs/spec.md §7）。
   */
  onDelete?: () => void;
  deleteDisabled?: boolean;
  /** 削除の代わりに下段へ置く操作（簡易入力の「詳細」）。 */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 pt-2">
      <Button className="w-full" disabled={saveDisabled} onClick={onSave}>
        {saveLabel}
      </Button>

      {onDelete && (
        <Button
          variant="destructive"
          className="w-full"
          disabled={deleteDisabled}
          onClick={onDelete}
        >
          <Trash2 className="size-4" />
          削除
        </Button>
      )}

      {children}
    </div>
  );
}
