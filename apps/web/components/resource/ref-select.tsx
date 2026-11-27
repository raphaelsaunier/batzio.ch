"use client";

import { Check, ChevronsUpDown, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { refOptionsAction, type RefOption } from "@/app/(app)/[tenant]/actions";
import { Badge } from "@/components/ui/badge";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useT } from "@batzio/i18n/react";

/**
 * Pickers look like the other fields (flat, squircle), not like buttons. Their lists render in
 * place, often right inside a Field, so list widths are set on [popover] to beat its `*:w-full`.
 */
const TRIGGER =
  "field flex w-full min-w-0 items-center border px-2.5 text-left text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";

function useOptions(tenant: string, resource: string, filter?: Record<string, string | number | boolean>) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<RefOption[]>([]);
  const [loading, start] = useTransition();
  const loaded = useRef(false);
  const filterKey = JSON.stringify(filter ?? {});

  const load = (q: string) =>
    start(async () => {
      setOptions(await refOptionsAction(tenant, resource, q, filter));
      loaded.current = true;
    });

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => load(query), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filterKey]);

  return { query, setQuery, options, loading, ensureLoaded: () => !loaded.current && load("") };
}


/** One Escape closes the list and keeps the search, as before, instead of first clearing the text. */
function closeOnEscape(
  query: string,
  details: { reason: string; cancel: () => void },
  setQuery: (q: string) => void,
  setOpen: (open: boolean) => void,
) {
  if (details.reason === "escape-key") {
    details.cancel();
    setOpen(false);
    return;
  }
  setQuery(query);
}

export function RefSelect({
  tenant,
  resource,
  value,
  label,
  onChange,
  filter,
  placeholder,
  disabled,
  invalid,
  className,
  compact,
}: {
  tenant: string;
  resource: string;
  value: number | null;
  label?: string | null;
  onChange: (id: number | null, label: string | null) => void;
  filter?: Record<string, string | number | boolean>;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  compact?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { query, setQuery, options, loading, ensureLoaded } = useOptions(tenant, resource, filter);
  const display = value ? (label ?? `#${value}`) : null;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) ensureLoaded();
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid}
            className={cn(TRIGGER, "h-8 justify-between gap-1.5", compact && "h-7 text-xs", !display && "text-muted-foreground", className)}
          />
        }
      >
        <span className="truncate">{display ?? placeholder ?? t("Select…")}</span>
        <span className="flex items-center gap-1">
          {display && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label={t("Clear")}
              className="rounded p-0.5 opacity-50 hover:bg-muted hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null, null);
              }}
            >
              <X className="size-3.5" />
            </span>
          )}
          <ChevronsUpDown className="size-3.5 opacity-50" />
        </span>
      </PopoverTrigger>
      <PopoverContent className="min-w-64 p-0 [&[popover]]:w-(--anchor-width)" align="start">
        <Command filter={false} query={query} onQueryChange={(q, details) => closeOnEscape(q, details, setQuery, setOpen)}>
          <CommandInput aria-label={t("Search")} placeholder={t("Search…")} />
          {loading && options.length === 0 ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : (
            <CommandEmpty>{t("No results.")}</CommandEmpty>
          )}
          <CommandList>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.id}
                  value={String(o.id)}
                  onSelect={() => {
                    onChange(o.id, o.label);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("size-4", value === o.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function TagsSelect({
  tenant,
  resource,
  value,
  labels,
  onChange,
  disabled,
}: {
  tenant: string;
  resource: string;
  value: number[];
  labels: Record<string, string>;
  onChange: (ids: number[], labels: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { query, setQuery, options, ensureLoaded } = useOptions(tenant, resource);
  const toggle = (o: RefOption) => {
    const next = value.includes(o.id) ? value.filter((v) => v !== o.id) : [...value, o.id];
    onChange(next, { ...labels, [o.id]: o.label });
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) ensureLoaded();
      }}
    >
      <PopoverTrigger disabled={disabled} render={<button type="button" className={cn(TRIGGER, "min-h-8 justify-start gap-1 px-2 py-1")} />}>
        {value.length === 0 && <span className="text-muted-foreground">{t("Select…")}</span>}
        <span className="flex flex-wrap gap-1">
          {value.map((id) => (
            <Badge key={id} variant="secondary" className="font-normal">
              {labels[id] ?? `#${id}`}
            </Badge>
          ))}
        </span>
      </PopoverTrigger>
      <PopoverContent className="p-0 [&[popover]]:w-64" align="start">
        <Command filter={false} query={query} onQueryChange={(q, details) => closeOnEscape(q, details, setQuery, setOpen)}>
          <CommandInput aria-label={t("Search")} placeholder={t("Search…")} />
          <CommandEmpty>{t("No results.")}</CommandEmpty>
          <CommandList>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.id} value={String(o.id)} onSelect={() => toggle(o)}>
                  <Check className={cn("size-4", value.includes(o.id) ? "opacity-100" : "opacity-0")} />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
