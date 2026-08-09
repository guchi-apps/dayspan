import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-xs border border-outline bg-transparent px-4 py-3 text-base transition-colors outline-none placeholder:text-muted-foreground hover:border-on-surface focus-visible:border-primary focus-visible:shadow-[inset_0_0_0_1px_var(--color-primary)] disabled:cursor-not-allowed disabled:border-outline/38 disabled:opacity-38 aria-invalid:border-destructive aria-invalid:shadow-[inset_0_0_0_1px_var(--color-destructive)] md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
