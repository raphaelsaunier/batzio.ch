"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { explain, termFor } from "@batzio/i18n/glossary";
import { useLocale, useT } from "@batzio/i18n/react";
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

/**
 * The explanation renders in place, inside whatever holds the term (a <p>, a label, a
 * table header, a link card). So it is phrasing content only, resets the text styles
 * it would inherit there, and keeps presses from reaching that link or label.
 */
const CONTENT = "w-72 cursor-auto text-start font-sans font-normal tracking-normal normal-case whitespace-normal select-text";
const keepInside = (e: React.MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

function Explanation({ id }: { id: string }) {
  const locale = useLocale();
  const t = useT();
  const entry = explain(id, locale);
  if (!entry) return null;
  return (
    <span className="flex gap-2.5">
      <Batzi mood="thinking" className="mt-0.5 size-8 shrink-0" />
      <span className="space-y-1">
        <span className="font-display block text-sm font-semibold">{entry.term}</span>
        <span className="text-muted-foreground block text-xs leading-relaxed">{entry.text}</span>
        <span className="text-muted-foreground/70 block text-[10px] tracking-wide uppercase">{t("Jargon, decoded")}</span>
      </span>
    </span>
  );
}

/** document.body once mounted: where a `portal` explanation renders, outside the link around the term. */
function useBody() {
  const [body, setBody] = useState<HTMLElement | null>(null);
  useEffect(() => setBody(document.body), []);
  return body;
}

/**
 * Wraps an accounting term with a dotted underline and a plain-language
 * explanation. Pass `id` (glossary key) or let it look up the English `label`.
 * Inside a link (a card or tile that navigates), pass `portal`: the explanation then renders in
 * <body> instead of inside the <a>, and a press on the term still follows the link.
 */
export function Term({ id, label, children, className, portal }: { id?: string | null; label?: string; children?: React.ReactNode; className?: string; portal?: boolean }) {
  const termId = id ?? termFor(label ?? (typeof children === "string" ? children : null));
  const { open, setOpen, hover } = useHoverOpen();
  const body = useBody();
  if (!termId) return <>{children ?? label}</>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <span
            role="button"
            tabIndex={0}
            {...hover}
            className={cn("decoration-primary/45 hover:decoration-primary cursor-help underline decoration-dotted underline-offset-[3px]", className)}
          />
        }
      >
        {children ?? label}
      </PopoverTrigger>
      <PopoverContent side="top" className={CONTENT} render={<span />} {...hover} onClick={keepInside} initialFocus="none" container={portal ? body : undefined}>
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
      <PopoverTrigger
        {...hover}
        aria-label={t("What does this mean?")}
        className={cn(
          "border-primary/30 text-primary/80 hover:bg-primary hover:text-primary-foreground inline-flex size-3.5 shrink-0 translate-y-[-1px] items-center justify-center rounded-full border text-[9px] leading-none font-bold transition-colors",
          className,
        )}
      >
        ?
      </PopoverTrigger>
      <PopoverContent side="top" className={CONTENT} render={<span />} {...hover} onClick={keepInside} initialFocus="none">
        <Explanation id={termId} />
      </PopoverContent>
    </Popover>
  );
}
