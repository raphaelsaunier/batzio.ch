import * as React from "react"
import { cn } from "cn"
import { Textarea as TextareaPrimitive } from "@ui-sdk/react/textarea"

function Textarea({
  className,
  ...props
}: Omit<React.ComponentProps<typeof TextareaPrimitive>, "className"> & {
  className?: string
}) {
  return (
    <TextareaPrimitive
      className={cn(
        "flex field-sizing-content min-h-16 w-full field border px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
