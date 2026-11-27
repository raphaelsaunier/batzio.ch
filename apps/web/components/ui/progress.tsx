import * as React from "react"
import { cn } from "cn"
import {
  Progress as ProgressPrimitive,
  ProgressIndicator,
  ProgressTrack,
} from "@ui-sdk/react/progress"

function Progress({
  className,
  ...props
}: Omit<React.ComponentProps<typeof ProgressPrimitive>, "className"> & {
  className?: string
}) {
  return (
    <ProgressPrimitive
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      <ProgressTrack className="size-full">
        {/* The part sets the width inline from the value; w-0 keeps an indeterminate bar empty. */}
        <ProgressIndicator className="h-full w-0 bg-primary transition-all" />
      </ProgressTrack>
    </ProgressPrimitive>
  )
}

export { Progress }
