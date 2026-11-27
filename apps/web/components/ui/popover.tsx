import * as React from "react"
import { cn } from "cn"
import {
  Popover,
  PopoverContent as PopoverContentPrimitive,
  PopoverDescription as PopoverDescriptionPrimitive,
  PopoverTitle as PopoverTitlePrimitive,
  PopoverTrigger,
} from "@ui-sdk/react/popover"
import { renderElement, type PartProps } from "@ui-sdk/react/primitive"

// String class names only, so server components can render these wrappers.
type Props<T extends React.ElementType> = Omit<
  React.ComponentProps<T>,
  "className"
> & { className?: string }

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: Props<typeof PopoverContentPrimitive>) {
  return (
    <PopoverContentPrimitive
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden transition-[opacity,scale,translate] duration-100 data-starting-style:scale-95 data-starting-style:opacity-0 data-[side=bottom]:data-starting-style:-translate-y-2 data-[side=left]:data-starting-style:translate-x-2 data-[side=right]:data-starting-style:-translate-x-2 data-[side=top]:data-starting-style:translate-y-2 data-ending-style:scale-95 data-ending-style:opacity-0 motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

function PopoverHeader({
  className,
  render,
  ...props
}: Omit<PartProps<"div">, "className"> & { className?: string }) {
  return renderElement(
    "div",
    {
      "data-slot": "popover-header",
      className: cn("flex flex-col gap-0.5 text-sm", className),
      ...props,
    },
    render
  )
}

function PopoverTitle({
  className,
  ...props
}: Props<typeof PopoverTitlePrimitive>) {
  return (
    <PopoverTitlePrimitive className={cn("font-medium", className)} {...props} />
  )
}

function PopoverDescription({
  className,
  ...props
}: Props<typeof PopoverDescriptionPrimitive>) {
  return (
    <PopoverDescriptionPrimitive
      className={cn("text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
}
