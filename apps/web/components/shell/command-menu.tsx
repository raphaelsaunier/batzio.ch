"use client";

import { Plus, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { globalSearchAction, type SearchHit } from "@/app/(app)/[tenant]/actions";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import type { NavSection } from "@batzio/server/navigation";
import { useT } from "@batzio/i18n/react";
import { N_ } from "@batzio/i18n";

const QUICK_CREATE = [
  { resource: "invoices", label: N_("New invoice"), icon: "Receipt" },
  { resource: "quotes", label: N_("New quote"), icon: "FileText" },
  { resource: "contacts", label: N_("New contact"), icon: "Users" },
  { resource: "bills", label: N_("New supplier bill"), icon: "FileInput" },
  { resource: "expenses", label: N_("New expense"), icon: "Wallet" },
  { resource: "timesheets", label: N_("Log time"), icon: "Timer" },
  { resource: "journal_entries", label: N_("New journal entry"), icon: "NotebookPen" },
];

export function CommandMenu({ tenant, sections }: { tenant: string; sections: NavSection[] }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = setTimeout(() => {
      startTransition(async () => setHits(await globalSearchAction(tenant, query)));
    }, 180);
    return () => clearTimeout(handle);
  }, [query, tenant]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const grouped = hits.reduce<Record<string, SearchHit[]>>((acc, h) => {
    (acc[h.resourceLabel] ??= []).push(h);
    return acc;
  }, {});

  return (
    <>
      <Button
        variant="outline"
        className="h-8 w-full max-w-72 justify-start gap-2 bg-muted/40 px-2.5 text-muted-foreground shadow-none sm:w-72"
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" />
        <span className="flex-1 text-left text-sm">{t("Search or jump to…")}</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t("Search")}
        description={t("Search records and navigate")}
        query={query}
        onQueryChange={(q, details) => {
          // One Escape closes the palette and keeps the search, as before, instead of first clearing it.
          if (details.reason === "escape-key") {
            details.cancel();
            setOpen(false);
            return;
          }
          setQuery(q);
        }}
      >
        <CommandInput aria-label={t("Search")} placeholder={t("Search contacts, invoices, accounts…")} />
        <CommandEmpty>{t("No results.")}</CommandEmpty>
        <CommandList>
          {query.trim().length > 2 && (
            <CommandGroup heading="Batzi">
              <CommandItem
                value="ask-batzi"
                onSelect={() => {
                  setOpen(false);
                  window.dispatchEvent(new CustomEvent("batzio:ask", { detail: query }));
                  setQuery("");
                }}
              >
                <Sparkles /> {t("Ask Batzi: “{text}”", { text: query })}
              </CommandItem>
            </CommandGroup>
          )}
          {Object.entries(grouped).map(([label, list]) => (
            <CommandGroup key={label} heading={t(label)}>
              {list.map((h) => (
                <CommandItem key={`${h.resource}-${h.id}`} value={`${h.resource}-${h.id}`} keywords={[label, String(h.id)]} onSelect={() => go(h.href)}>
                  {h.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
          {hits.length > 0 && <CommandSeparator />}
          <CommandGroup heading={t("Create")}>
            {QUICK_CREATE.map((c) => (
              <CommandItem key={c.resource} value={`create:${c.resource}`} keywords={[c.resource]} onSelect={() => go(`/${tenant}/${c.resource}/new`)}>
                <Plus /> {t(c.label)}
              </CommandItem>
            ))}
          </CommandGroup>
          {sections.map((s) => (
            <CommandGroup key={s.id} heading={s.label ? t(s.label) : undefined}>
              {s.items.map((item) => (
                <CommandItem key={item.href} value={`${s.id}:${item.href}`} keywords={[t(s.label), item.href]} onSelect={() => go(item.href)}>
                  <Icon name={item.icon} /> {t(item.title)}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
