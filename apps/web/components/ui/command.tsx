"use client"

import * as React from "react"
import {
  Command as CommandPrimitive,
  CommandEmpty as CommandEmptyPrimitive,
  CommandGroup as CommandGroupPrimitive,
  CommandGroupLabel,
  CommandInput as CommandInputPrimitive,
  CommandItem as CommandItemPrimitive,
  CommandList as CommandListPrimitive,
  CommandSeparator as CommandSeparatorPrimitive,
  CommandShortcut as CommandShortcutPrimitive,
} from "@ui-sdk/react/command"
import { cn } from "cn"
import { useT } from "@batzio/i18n/react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  InputGroup,
  InputGroupAddon,
} from "@/components/ui/input-group"
import { SearchIcon, CheckIcon } from "lucide-react"

// String class names only, so server components can render these wrappers.
type Props<T extends React.ElementType> = Omit<
  React.ComponentProps<T>,
  "className"
> & { className?: string }

function Command({
  className,
  announcement,
  ...props
}: Props<typeof CommandPrimitive>) {
  const t = useT()
  return (
    <CommandPrimitive
      // ui-sdk announces result counts in English by default; say them in the UI's language.
      announcement={
        announcement ??
        ((change) =>
          change.type !== "results"
            ? null
            : change.loading
              ? t("Loading…")
              : change.count === 0
                ? t("No results.")
                : change.count === 1
                  ? t("1 result")
                  : t("{n} results", { n: change.count }))
      }
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl! bg-popover p-1 text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

// Dialog state goes to the dialog; everything else (query, onAction, filter…) to the Command.
function CommandDialog({
  open,
  defaultOpen,
  onOpenChange,
  title = "Command Palette",
  description = "Search for a command to run...",
  className,
  showCloseButton = false,
  ...props
}: Omit<React.ComponentProps<typeof Command>, "title" | "className"> &
  Pick<
    React.ComponentProps<typeof Dialog>,
    "open" | "defaultOpen" | "onOpenChange"
  > & {
    title?: string
    description?: string
    className?: string
    showCloseButton?: boolean
  }) {
  return (
    <Dialog open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0 sm:max-w-lg",
          className
        )}
        showCloseButton={showCloseButton}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command {...props} />
      </DialogContent>
    </Dialog>
  )
}

// The search text lives on Command (query / onQueryChange), not on the input.
function CommandInput({
  className,
  ...props
}: Omit<Props<typeof CommandInputPrimitive>, "value" | "defaultValue">) {
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <InputGroup className="h-8! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:pl-2!">
        <CommandInputPrimitive
          className={cn(
            "w-full text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
        />
        <InputGroupAddon>
          <SearchIcon className="size-4 shrink-0 opacity-50" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

function CommandList({
  className,
  ...props
}: Props<typeof CommandListPrimitive>) {
  return (
    <CommandListPrimitive
      className={cn(
        "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
        className
      )}
      {...props}
    />
  )
}

// Always rendered (it is a live region); it only takes room while nothing matches.
function CommandEmpty({
  className,
  ...props
}: Props<typeof CommandEmptyPrimitive>) {
  return (
    <CommandEmptyPrimitive
      className={cn("text-center text-sm data-empty:py-6", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  heading,
  children,
  ...props
}: Omit<Props<typeof CommandGroupPrimitive>, "children"> & {
  heading?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <CommandGroupPrimitive
      className={cn("overflow-hidden p-1 text-foreground", className)}
      {...props}
    >
      {heading != null && heading !== "" && (
        <CommandGroupLabel className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {heading}
        </CommandGroupLabel>
      )}
      {children}
    </CommandGroupPrimitive>
  )
}

function CommandSeparator({
  className,
  ...props
}: Props<typeof CommandSeparatorPrimitive>) {
  return (
    <CommandSeparatorPrimitive
      className={cn("-mx-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  ...props
}: Omit<Props<typeof CommandItemPrimitive>, "children"> & {
  children?: React.ReactNode
}) {
  return (
    <CommandItemPrimitive
      className={cn(
        "group/command-item relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-lg! data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted data-highlighted:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-highlighted:*:[svg]:text-foreground",
        className
      )}
      {...props}
    >
      {children}
      <CheckIcon className="ml-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </CommandItemPrimitive>
  )
}

// Shows its children, or the enclosing CommandItem's `shortcut` formatted for the platform.
function CommandShortcut({
  className,
  ...props
}: Props<typeof CommandShortcutPrimitive>) {
  return (
    <CommandShortcutPrimitive
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-data-highlighted/command-item:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
