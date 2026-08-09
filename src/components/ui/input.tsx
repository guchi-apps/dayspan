"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

// ネイティブの日付・時刻系inputはブラウザが常にプレースホルダ相当の表示（mm/dd/yyyy等）を
// 出すため、ラベルを中央の休止位置に置くと重なる。これらのtypeは常にラベルを浮かせておく。
const ALWAYS_FLOATED_TYPES = new Set(["date", "time", "datetime-local", "month", "week"])

function Input({
  className,
  type,
  label,
  id,
  variant = "outlined",
  onFocus,
  onBlur,
  onChange,
  value,
  defaultValue,
  ...props
}: React.ComponentProps<"input"> & {
  label?: string
  /** M3のテキストフィールドは Filled と Outlined の2種類。既定はOutlined。 */
  variant?: "filled" | "outlined"
}) {
  const autoId = React.useId()
  const inputId = id ?? autoId
  const [focused, setFocused] = React.useState(false)
  // 非制御（valueを渡さない）場合だけ、入力イベントから空かどうかを自前で追う。
  const [uncontrolledHasValue, setUncontrolledHasValue] = React.useState(() => Boolean(defaultValue))
  const hasValue = value !== undefined ? Boolean(value) : uncontrolledHasValue

  const alwaysFloated = Boolean(type && ALWAYS_FLOATED_TYPES.has(type))
  const floated = Boolean(label) && (focused || hasValue || alwaysFloated)

  const inputEl = (
    <input
      id={inputId}
      type={type}
      data-slot="input"
      value={value}
      defaultValue={defaultValue}
      onFocus={(event) => {
        setFocused(true)
        onFocus?.(event)
      }}
      onBlur={(event) => {
        setFocused(false)
        onBlur?.(event)
      }}
      onChange={(event) => {
        if (value === undefined) setUncontrolledHasValue(event.target.value.length > 0)
        onChange?.(event)
      }}
      className={cn(
        "peer h-14 w-full min-w-0 rounded-xs text-base text-foreground transition-colors outline-none",
        "file:mr-2 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        "placeholder:text-muted-foreground disabled:pointer-events-none disabled:opacity-38 md:text-sm",
        label ? "px-4 pt-4 pb-1.5 placeholder:text-transparent focus:placeholder:text-muted-foreground" : "px-4",
        // フォーカス時は2dpへ太らせたいが、border幅を変えると内容が1pxずれる。
        // 既存の1px枠はそのままに、内側へもう1px重ねてshadowで太さを表現する。
        variant === "outlined" &&
          "border border-outline bg-transparent hover:border-on-surface focus-visible:border-primary focus-visible:shadow-[inset_0_0_0_1px_var(--color-primary)] disabled:border-outline/38",
        variant === "filled" &&
          "rounded-b-none border-b border-outline bg-muted hover:bg-muted/70 focus-visible:border-primary focus-visible:shadow-[inset_0_-1px_0_var(--color-primary)] disabled:bg-on-surface/4 disabled:border-outline/38",
        "aria-invalid:border-destructive aria-invalid:shadow-[inset_0_0_0_1px_var(--color-destructive)]",
        className
      )}
      {...props}
    />
  )

  if (!label) return inputEl

  return (
    <div className="relative w-full min-w-0">
      {inputEl}
      <label
        htmlFor={inputId}
        className={cn(
          "pointer-events-none absolute origin-left text-muted-foreground transition-all select-none",
          "peer-aria-invalid:text-destructive peer-disabled:opacity-38",
          floated
            ? "-top-2.5 left-3 max-w-[calc(100%-1rem)] truncate bg-(--field-notch) px-1 text-xs peer-focus-visible:text-primary"
            : "top-1/2 left-4 -translate-y-1/2 text-base"
        )}
      >
        {label}
      </label>
    </div>
  )
}

export { Input }
