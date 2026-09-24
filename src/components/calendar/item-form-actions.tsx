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
 * 中身が長くてダイアログがスクロールするときも、この帯は画面の下端に留まる（sticky）。
 * 保存のためだけに末尾までスクロールさせない。ダイアログ下端の余白（ホームバーを
 * 避けるセーフエリア分）は負の余白で帯の側に取り込み、余白の上へ入力欄が透けて見えないようにする。
 * 張り付く位置（bottom）も同じ分だけ負にする。0のままだと、負の余白で下端へ寄せた帯が
 * ダイアログの内側の下端（余白の上）へ押し戻され、ホームバーのある端末ではその差ぶん
 * 帯が上の入力欄へ被る（保存先カレンダーのチップ行が下から切れた・issue #769）。
 * 上の罫線は、入力欄が帯の下へ潜っていることを示す。
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
    <div className="sticky bottom-[calc(-1*env(safe-area-inset-bottom))] z-10 -mx-6 -mb-[env(safe-area-inset-bottom)] flex flex-col gap-2 border-t border-outline-variant bg-surface-container-high px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
