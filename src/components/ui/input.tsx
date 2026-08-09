"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { fieldShell, fieldLabel, fieldControl } from "@/components/ui/field"

// iOSのSafariは日付・時刻系inputを固有の幅で描画し、width:100% や min-width:0 を無視する。
// ネイティブの外観を切ると通常の要素として幅に従うため、この種のtypeだけ外観を落とす。
const NATIVE_SIZED_TYPES = new Set(["date", "time", "datetime-local", "month", "week"])

function Input({
  className,
  type,
  label,
  id,
  variant = "filled",
  ...props
}: React.ComponentProps<"input"> & {
  label?: string
  /** M3のテキストフィールドは Filled と Outlined の2種類。ラベル付きの既定はFilled。 */
  variant?: "filled" | "outlined"
}) {
  const autoId = React.useId()
  const inputId = id ?? autoId

  const inputEl = (
    <input
      id={inputId}
      type={type}
      data-slot="input"
      className={cn(
        label ? cn(fieldControl, "h-6") : undefined,
        // 外観を落とすと iOS でも幅の指定どおりに描画され、ダイアログからはみ出さなくなる。
        type && NATIVE_SIZED_TYPES.has(type) && "appearance-none [-webkit-appearance:none]",
        !label &&
          "h-14 w-full min-w-0 rounded-xs border border-outline bg-transparent px-4 text-base text-foreground transition-colors outline-none placeholder:text-muted-foreground hover:border-on-surface focus-visible:border-primary focus-visible:shadow-[inset_0_0_0_1px_var(--color-primary)] disabled:pointer-events-none disabled:opacity-38 md:text-sm",
        className
      )}
      {...props}
    />
  )

  if (!label) return inputEl

  return (
    <div data-slot="field" className={fieldShell(variant, "h-14")}>
      <label htmlFor={inputId} className={fieldLabel}>
        {label}
      </label>
      {inputEl}
    </div>
  )
}

export { Input }
