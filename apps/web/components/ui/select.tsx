import * as React from "react"
import { cn } from "cn"
import {
  Select,
  SelectContent as SelectContentPrimitive,
  SelectGroup as SelectGroupPrimitive,
  SelectGroupLabel,
  SelectItem as SelectItemPrimitive,
  SelectItemIndicator,
  SelectSeparator as SelectSeparatorPrimitive,
  SelectTrigger as SelectTriggerPrimitive,
  SelectValue,
} from "@ui-sdk/react/select"
import { ChevronDownIcon, CheckIcon } from "lucide-react"

// String class names and plain children only, so server components can render these wrappers.
type Props<P> = Omit<P, "className" | "children"> & {
  className?: string
  children?: React.ReactNode
}

function SelectGroup({
  className,
  ...props
}: Props<React.ComponentProps<typeof SelectGroupPrimitive>>) {
  return (
    <SelectGroupPrimitive
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: Props<React.ComponentProps<typeof SelectTriggerPrimitive>> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectTriggerPrimitive
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 field border py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon
        aria-hidden
        className="pointer-events-none size-4 text-muted-foreground"
      />
    </SelectTriggerPrimitive>
  )
}

function SelectContent({
  className,
  position = "item-aligned",
  align = "center",
  ...props
}: Omit<
  Props<React.ComponentProps<typeof SelectContentPrimitive>>,
  "alignItemWithTrigger"
> & {
  position?: "popper" | "item-aligned"
}) {
  return (
    <SelectContentPrimitive
      data-align-trigger={position === "item-aligned"}
      alignItemWithTrigger={position === "item-aligned"}
      align={align}
      className={cn(
        "max-h-(--available-height) min-w-[max(--spacing(36),var(--anchor-width))] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-[opacity,scale,translate] duration-100 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 data-[side=bottom]:data-starting-style:-translate-y-2 data-[side=left]:data-starting-style:translate-x-2 data-[side=right]:data-starting-style:-translate-x-2 data-[side=top]:data-starting-style:translate-y-2 data-[align-trigger=true]:transition-none motion-reduce:transition-none",
        // The list renders in place, so child selectors of its parent (like Field's *:w-full) reach it.
        "[&[popover]]:w-auto",
        className
      )}
      {...props}
    />
  )
}

function SelectLabel({
  className,
  ...props
}: Props<React.ComponentProps<typeof SelectGroupLabel>>) {
  return (
    <SelectGroupLabel
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: Props<React.ComponentProps<typeof SelectItemPrimitive<string>>>) {
  return (
    <SelectItemPrimitive
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectItemIndicator>
          <CheckIcon className="pointer-events-none" />
        </SelectItemIndicator>
      </span>
      <span>{children}</span>
    </SelectItemPrimitive>
  )
}

function SelectSeparator({
  className,
  ...props
}: Props<React.ComponentProps<typeof SelectSeparatorPrimitive>>) {
  return (
    <SelectSeparatorPrimitive
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
