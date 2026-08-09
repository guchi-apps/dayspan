"use client"

import * as React from "react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { CheckIcon } from "lucide-react"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        // M3のチェックボックス。ボックスは18dp、角丸2dp。
        "group/checkbox peer relative flex size-[18px] shrink-0 items-center justify-center rounded-[2px] border-2 border-outline transition-colors outline-none",
        "group-has-disabled/field:opacity-38",
        "focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-38",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 aria-invalid:data-checked:border-primary",
        "data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground",
        // 状態レイヤー。18dpのボックスを40dp円で囲み、ホバー・フォーカス・押下で薄く色を乗せる。
        // -z-10で沈めないと、absolute配置の疑似要素がチェックマークより手前に描画されてしまう。
        "before:absolute before:-z-10 before:inset-[-11px] before:rounded-full before:bg-on-surface before:opacity-0 before:transition-opacity",
        "hover:before:opacity-8 focus-visible:before:opacity-10 active:before:opacity-10",
        "data-checked:before:bg-primary",
        "disabled:before:opacity-0",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        <CheckIcon />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
