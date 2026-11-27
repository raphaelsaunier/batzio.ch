"use client"

import * as React from "react"
import { cn } from "cn"
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastRegion,
  ToastTitle,
  type ToastRegionProps,
  type ToastType,
} from "@ui-sdk/react/toast"
import { useT } from "@batzio/i18n/react"
import {
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"

const icon = "-ms-1 me-1 size-4 shrink-0"

const icons: Partial<Record<ToastType, React.ReactNode>> = {
  success: <CircleCheckIcon className={icon} />,
  info: <InfoIcon className={icon} />,
  warning: <TriangleAlertIcon className={icon} />,
  error: <OctagonXIcon className={icon} />,
  loading: <LoaderCircleIcon className={cn(icon, "animate-spin")} />,
}

// Rich colours: each type tints the card with its own token.
const rich =
  "border-[color-mix(in_oklab,var(--tone)_30%,var(--popover))] bg-[color-mix(in_oklab,var(--tone)_10%,var(--popover))] text-[color-mix(in_oklab,var(--tone)_70%,var(--popover-foreground))]"

const tones: Partial<Record<ToastType, string>> = {
  success: "[--tone:var(--success)]",
  error: "[--tone:var(--destructive)]",
  warning: "[--tone:var(--warning)]",
  info: "[--tone:var(--info)]",
}

/*
 * A stack at the bottom edge: toasts sit 14px apart, the ones behind peek
 * out above the newest, 5% smaller each, and hovering spreads them out.
 */
function Toaster({
  className,
  shortcut = "alt+t",
  ...props
}: Omit<ToastRegionProps, "className" | "children" | "side"> & {
  className?: string
}) {
  const t = useT()
  return (
    <ToastRegion
      shortcut={shortcut}
      aria-label={t("Notifications")}
      pendingAnnouncement={t("Loading…")}
      className={cn(
        // fixed: keeps the server-rendered region out of the page flow until ui-sdk positions it.
        "fixed m-6 h-(--toast-front-height) w-[356px] data-expanded:h-[calc(var(--toast-stack-height)_+_(var(--toast-count)_-_1)_*_14px)] max-[600px]:m-4 max-[600px]:w-[calc(100vw_-_2rem)]",
        className
      )}
      {...props}
    >
      {(toast) => {
        const tone = tones[toast.type]
        return (
          <Toast
            className={cn(
              "absolute inset-x-0 bottom-0 z-[calc(100_-_var(--toast-index))] flex h-(--toast-height) translate-x-[var(--toast-swipe-x,0px)] translate-y-[calc(var(--y)_+_var(--toast-swipe-y,0px))] scale-[calc(1_-_var(--toast-index)_*_0.05)] items-center gap-1.5 rounded-lg border p-4 text-[13px] shadow-[0_4px_12px_rgba(0,0,0,0.1)] wrap-anywhere outline-none select-none [--y:calc(var(--toast-index)_*_-14px)] transition-[translate,scale,opacity,height,box-shadow] duration-400 *:transition-opacity *:duration-400 focus-visible:shadow-[0_4px_12px_rgba(0,0,0,0.1),0_0_0_2px_rgba(0,0,0,0.2)] not-data-front:not-data-expanded:h-(--toast-front-height) not-data-front:not-data-expanded:*:opacity-0 data-expanded:scale-100 data-expanded:[--y:calc(-1_*_(var(--toast-offset)_+_var(--toast-index)_*_14px))] data-starting-style:opacity-0 data-starting-style:transition-none data-starting-style:data-front:[--y:100%] data-ending-style:opacity-0 data-ending-style:data-front:[--y:100%] data-swiping:transition-none data-[swipe-direction=left]:-translate-x-full data-[swipe-direction=right]:translate-x-full motion-reduce:transition-none",
              tone
                ? cn(rich, tone)
                : "border-border bg-popover text-popover-foreground"
            )}
          >
            {toast.type !== "loading" && (
              <ToastClose
                aria-label="Close toast"
                className="absolute top-0 left-0 z-1 flex size-5 -translate-x-[35%] -translate-y-[35%] cursor-pointer items-center justify-center rounded-full border border-inherit bg-inherit p-0 hover:border-border hover:bg-muted [&_svg]:size-3"
              >
                <XIcon />
              </ToastClose>
            )}
            {icons[toast.type]}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <ToastTitle className="leading-normal font-medium" />
              <ToastDescription
                className={cn("leading-[1.4]", !tone && "text-muted-foreground")}
              />
            </div>
            <ToastAction className="ms-auto flex h-6 shrink-0 cursor-pointer items-center rounded-[4px] bg-popover-foreground px-2 text-xs font-medium text-popover outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
          </Toast>
        )
      }}
    </ToastRegion>
  )
}

export { Toaster }
