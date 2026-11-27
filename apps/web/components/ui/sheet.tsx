import * as React from "react"
import { cn } from "cn"
import {
  Dialog as Sheet,
  DialogBackdrop,
  DialogClose as SheetClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger as SheetTrigger,
} from "@ui-sdk/react/dialog"

import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

// A Dialog styled as a side panel (not a Drawer), so it keeps Radix's
// behaviour: modal, Escape and outside press close it, no drag gestures.
// String class names only, so server components can render these wrappers.
type Props<T extends React.ElementType> = Omit<
  React.ComponentProps<T>,
  "className"
> & { className?: string }

function SheetOverlay({ className, ...props }: Props<typeof DialogBackdrop>) {
  return (
    <DialogBackdrop
      className={cn(
        "fixed inset-0 bg-black/10 transition-opacity duration-100 supports-backdrop-filter:backdrop-blur-xs data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: Omit<Props<typeof DialogContent>, "children"> & {
  children?: React.ReactNode
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <>
      <SheetOverlay />
      <DialogContent
        data-side={side}
        className={cn(
          "fixed flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition-[opacity,translate] duration-200 ease-in-out data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-starting-style:opacity-0 data-ending-style:opacity-0 data-[side=bottom]:data-starting-style:translate-y-10 data-[side=bottom]:data-ending-style:translate-y-10 data-[side=left]:data-starting-style:-translate-x-10 data-[side=left]:data-ending-style:-translate-x-10 data-[side=right]:data-starting-style:translate-x-10 data-[side=right]:data-ending-style:translate-x-10 data-[side=top]:data-starting-style:-translate-y-10 data-[side=top]:data-ending-style:-translate-y-10 motion-reduce:transition-none",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetClose
            render={
              <Button
                variant="ghost"
                className="absolute top-3 right-3"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </SheetClose>
        )}
      </DialogContent>
    </>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: Props<typeof DialogTitle>) {
  return (
    <DialogTitle
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className
      )}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: Props<typeof DialogDescription>) {
  return (
    <DialogDescription
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
