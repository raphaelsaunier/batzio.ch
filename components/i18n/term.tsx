"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { explain, termFor } from "@/lib/i18n/glossary";
import { useLocale, useT } from "@/lib/i18n/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Batzi } from "@/components/fun/batzi";

/** Opens on hover (desktop) and on tap (touch), closes when the pointer leaves. */
function useHoverOpen() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => timer.current && clearTimeout(timer.current);
  return {
    open,
    setOpen,
    hover: {
      onPointerEnter: (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        clear();
        timer.current = setTimeout(() => setOpen(true), 250);
      },
      onPointerLeave: (e: React.PointerEvent) => {
        if (e.pointerType !== "mouse") return;
        clear();
        timer.current = setTimeout(() => setOpen(false), 150);
      },
    },
  };
}

function Explanation({ id }: { id: string }) {
  const locale = useLocale();
  const t = useT();
  const entry = explain(id, locale);
  if (!entry) return null;
  return (
    <div className="flex gap-2.5">
      <Batzi mood="thinking" className="mt-0.5 size-8 shrink-0" />
      <div className="space-y-1">
        <p className="font-display text-sm font-semibold">{entry.term}</p>
        <p className="text-muted-foreground text-xs leading-relaxed">{entry.text}</p>
        <p className="text-muted-foreground/70 text-[10px] tracking-wide uppercase">{t("Jargon, decoded")}</p>
      </div>
    </div>
  );
}

/**
 * Wraps an accounting term with a dotted underline and a plain-language
 * explanation. Pass `id` (glossary key) or let it look up the English `label`.
 */
export function Term({ id, label, children, className }: { id?: string | null; label?: string; children?: React.ReactNode; className?: string }) {
  const termId = id ?? termFor(label ?? (typeof children === "string" ? children : null));
  const { open, setOpen, hover } = useHoverOpen();
  if (!termId) return <>{children ?? label}</>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          {...hover}
          className={cn("decoration-primary/45 hover:decoration-primary cursor-help underline decoration-dotted underline-offset-[3px]", className)}
        >
          {children ?? label}
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-72" {...hover} onOpenAutoFocus={(e) => e.preventDefault()}>
        <Explanation id={termId} />
      </PopoverContent>
    </Popover>
  );
}

/** A small “?” bubble for labels that should stay visually clean (form fields, table headers). */
export function TermHint({ id, label, className }: { id?: string | null; label?: string; className?: string }) {
  const termId = id ?? termFor(label);
  const { open, setOpen, hover } = useHoverOpen();
  const t = useT();
  if (!termId) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          {...hover}
          aria-label={t("What does this mean?")}
          className={cn(
            "border-primary/30 text-primary/80 hover:bg-primary hover:text-primary-foreground inline-flex size-3.5 shrink-0 translate-y-[-1px] items-center justify-center rounded-full border text-[9px] leading-none font-bold transition-colors",
            className,
          )}
        >
          ?
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" className="w-72" {...hover} onOpenAutoFocus={(e) => e.preventDefault()}>
        <Explanation id={termId} />
      </PopoverContent>
    </Popover>
  );
}
