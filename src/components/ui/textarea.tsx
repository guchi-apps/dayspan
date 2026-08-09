"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { fieldShell, fieldLabel, fieldControl } from "@/components/ui/field"

function Textarea({
  className,
  label,
  id,
  variant = "filled",
  ...props
}: React.ComponentProps<"textarea"> & {
  label?: string
  variant?: "filled" | "outlined"
}) {
  const autoId = React.useId()
  const textareaId = id ?? autoId

  const textareaEl = (
    <textarea
      id={textareaId}
      data-slot="textarea"
      className={cn(
        label
          ? cn(fieldControl, "field-sizing-content min-h-16 resize-none")
          : "flex field-sizing-content min-h-16 w-full rounded-xs border border-outline bg-transparent px-4 py-3 text-base transition-colors outline-none placeholder:text-muted-foreground hover:border-on-surface focus-visible:border-primary focus-visible:shadow-[inset_0_0_0_1px_var(--color-primary)] disabled:cursor-not-allowed disabled:border-outline/38 disabled:opacity-38 aria-invalid:border-destructive aria-invalid:shadow-[inset_0_0_0_1px_var(--color-destructive)] md:text-sm",
        className
      )}
      {...props}
    />
  )

  if (!label) return textareaEl

  return (
    <div data-slot="field" className={fieldShell(variant, "py-2")}>
      <label htmlFor={textareaId} className={fieldLabel}>
        {label}
      </label>
      {textareaEl}
    </div>
  )
}

export { Textarea }
