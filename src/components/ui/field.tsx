import { cn } from "@/lib/utils"

/**
 * M3のテキストフィールドの見た目をまとめる。Input / Textarea / Select で同じ形を使う。
 *
 * ラベルは枠線の上へ絶対配置せず、枠の中に通常のフローで積む。
 * 絶対配置は left/top が効かない環境で文字が縦に潰れる崩れ方をするうえ、
 * 枠線を切り欠く分だけ下地の色にも依存するため、この画面では採らない。
 */

/** ラベル付きフィールドの外枠。ラベルと入力欄を縦に積む。 */
export function fieldShell(variant: "filled" | "outlined" = "filled", className?: string) {
  return cn(
    "group/field flex w-full min-w-0 flex-col justify-center gap-0.5 px-4 transition-colors",
    "has-disabled:pointer-events-none has-disabled:opacity-38",
    variant === "filled" &&
      // 下端の線をフォーカスで2dpへ太らせたいが、border幅を変えると中身が1pxずれる。
      // 既存の1px枠はそのままに、内側へもう1px重ねてshadowで太さを表現する。
      "rounded-t-xs border-b border-outline bg-muted hover:bg-muted/70 focus-within:border-primary focus-within:shadow-[inset_0_-1px_0_var(--color-primary)]",
    variant === "outlined" &&
      "rounded-xs border border-outline bg-transparent hover:border-on-surface focus-within:border-primary focus-within:shadow-[inset_0_0_0_1px_var(--color-primary)]",
    "has-aria-invalid:border-destructive has-aria-invalid:shadow-[inset_0_0_0_1px_var(--color-destructive)]",
    className
  )
}

/** 枠の中の上部に置く見出し。常に表示して、何の欄か分からなくならないようにする。 */
export const fieldLabel =
  "truncate text-xs leading-4 text-muted-foreground select-none group-focus-within/field:text-primary group-has-aria-invalid/field:text-destructive"

/** 枠の中の入力部分。枠は外側が持つため、入力欄自身は線も背景も持たない。 */
export const fieldControl =
  "w-full min-w-0 border-0 bg-transparent p-0 text-base text-foreground outline-none placeholder:text-muted-foreground disabled:pointer-events-none md:text-sm"
