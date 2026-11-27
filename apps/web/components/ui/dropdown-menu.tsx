import * as React from "react"
import { cn } from "cn"
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemIndicator,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "@ui-sdk/react/menu"
import { CheckIcon, ChevronRightIcon } from "lucide-react"

// String class names only, so server components can render these wrappers.
type Props<T extends React.ElementType> = Omit<
  React.ComponentProps<T>,
  "className"
> & { className?: string }

function DropdownMenu({ ...props }: React.ComponentProps<typeof Menu>) {
  return <Menu {...props} />
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof MenuTrigger>) {
  return <MenuTrigger {...props} />
}

function DropdownMenuContent({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}: Props<typeof MenuContent>) {
  return (
    <MenuContent
      sideOffset={sideOffset}
      align={align}
      className={cn("max-h-(--available-height) w-(--anchor-width) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-[opacity,scale,translate] duration-100 data-closed:overflow-hidden data-starting-style:scale-95 data-starting-style:opacity-0 data-[side=bottom]:data-starting-style:-translate-y-2 data-[side=left]:data-starting-style:translate-x-2 data-[side=right]:data-starting-style:-translate-x-2 data-[side=top]:data-starting-style:translate-y-2 data-ending-style:scale-95 data-ending-style:opacity-0 motion-reduce:transition-none", className )}
      {...props}
    />
  )
}

function DropdownMenuGroup({ ...props }: React.ComponentProps<typeof MenuGroup>) {
  return <MenuGroup {...props} />
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: Omit<Props<typeof MenuItem>, "destructive"> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenuItem
      data-inset={inset}
      data-variant={variant}
      destructive={variant === "destructive"}
      className={cn(
        "group/dropdown-menu-item relative flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground data-inset:pl-7 data-[variant=destructive]:text-destructive data-[variant=destructive]:data-highlighted:bg-destructive/10 data-[variant=destructive]:data-highlighted:text-destructive dark:data-[variant=destructive]:data-highlighted:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-[variant=destructive]:*:[svg]:text-destructive",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  inset,
  ...props
}: Omit<Props<typeof MenuCheckboxItem>, "children"> & {
  children?: React.ReactNode
  inset?: boolean
}) {
  return (
    <MenuCheckboxItem
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-highlighted:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuItemIndicator>
          <CheckIcon
          />
        </MenuItemIndicator>
      </span>
      {children}
    </MenuCheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof MenuRadioGroup>) {
  return <MenuRadioGroup {...props} />
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: Omit<Props<typeof MenuRadioItem>, "children"> & {
  children?: React.ReactNode
  inset?: boolean
}) {
  return (
    <MenuRadioItem
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-highlighted:**:text-accent-foreground data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuItemIndicator>
          <CheckIcon
          />
        </MenuItemIndicator>
      </span>
      {children}
    </MenuRadioItem>
  )
}

// Names the group it sits in: it must be inside a DropdownMenuGroup or DropdownMenuRadioGroup.
function DropdownMenuLabel({
  className,
  inset,
  ...props
}: Props<typeof MenuGroupLabel> & {
  inset?: boolean
}) {
  return (
    <MenuGroupLabel
      data-inset={inset}
      className={cn(
        "px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: Props<typeof MenuSeparator>) {
  return (
    <MenuSeparator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: Props<typeof MenuShortcut>) {
  return (
    <MenuShortcut
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground group-data-highlighted/dropdown-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof MenuSub>) {
  return <MenuSub {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: Omit<Props<typeof MenuSubTrigger>, "children"> & {
  children?: React.ReactNode
  inset?: boolean
}) {
  return (
    <MenuSubTrigger
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground data-inset:pl-7 data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </MenuSubTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: Props<typeof MenuSubContent>) {
  return (
    <MenuSubContent
      className={cn("min-w-[96px] origin-(--transform-origin) overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10 transition-[opacity,scale,translate] duration-100 data-starting-style:scale-95 data-starting-style:opacity-0 data-[side=bottom]:data-starting-style:-translate-y-2 data-[side=left]:data-starting-style:translate-x-2 data-[side=right]:data-starting-style:-translate-x-2 data-[side=top]:data-starting-style:translate-y-2 data-ending-style:scale-95 data-ending-style:opacity-0 motion-reduce:transition-none", className )}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
