import * as React from "react"
import { cn } from "cn"
import {
  Tooltip as TooltipPrimitive,
  TooltipArrow,
  TooltipContent as TooltipContentPrimitive,
  TooltipTrigger,
} from "@ui-sdk/react/tooltip"

function Tooltip({
  delay = 300,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive>) {
  return <TooltipPrimitive delay={delay} {...props} />
}

// The 10px default offset makes room for the arrow, as Radix did.
function TooltipContent({
  className,
  sideOffset = 10,
  children,
  ...props
}: Omit<
  React.ComponentProps<typeof TooltipContentPrimitive>,
  "className" | "children"
> & { className?: string; children?: React.ReactNode }) {
  return (
    <TooltipContentPrimitive
      sideOffset={sideOffset}
      className={cn(
        "inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-3 py-1.5 text-xs text-background transition-[opacity,scale,translate] duration-150 has-data-[slot=kbd]:pr-1.5 not-data-instant:data-starting-style:scale-95 not-data-instant:data-starting-style:opacity-0 data-[side=bottom]:not-data-instant:data-starting-style:-translate-y-2 data-[side=left]:not-data-instant:data-starting-style:translate-x-2 data-[side=right]:not-data-instant:data-starting-style:-translate-x-2 data-[side=top]:not-data-instant:data-starting-style:translate-y-2 data-ending-style:scale-95 data-ending-style:opacity-0 motion-reduce:transition-none **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
        className
      )}
      {...props}
    >
      {children}
      <TooltipArrow className="size-2.5 rotate-45 rounded-[2px] bg-foreground data-[side=bottom]:bottom-full data-[side=bottom]:translate-y-[calc(50%_+_2px)] data-[side=left]:left-full data-[side=left]:translate-x-[calc(-50%_-_2px)] data-[side=right]:right-full data-[side=right]:translate-x-[calc(50%_+_2px)] data-[side=top]:top-full data-[side=top]:translate-y-[calc(-50%_-_2px)]" />
    </TooltipContentPrimitive>
  )
}

export { Tooltip, TooltipContent, TooltipTrigger }
