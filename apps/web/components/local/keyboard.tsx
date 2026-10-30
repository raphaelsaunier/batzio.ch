"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@batzio/i18n/react";
import { warmRecords } from "@/lib/local/store";
import { useLocalData } from "./local-data";

type Router = ReturnType<typeof useRouter>;

const prefetched = new Map<string, number>();

/** Fetches a page's full payload ahead of the click (deduplicated for 20 s). */
export function prefetchPage(router: Router, href: string) {
  const last = prefetched.get(href) ?? 0;
  if (Date.now() - last < 20_000) return;
  prefetched.set(href, Date.now());
  // vinext's router accepts Next.js' "full" prefetch kind (types still list the enum).
  router.prefetch(href, { kind: "full" } as unknown as Parameters<Router["prefetch"]>[1]);
}

/** Go-to chords (“g” then a letter), Superhuman style. */
const CHORDS: [string, string, string][] = [
  ["t", "", "Today"],
  ["i", "invoices", "Invoices"],
  ["q", "quotes", "Quotes"],
  ["b", "bills", "Bills"],
  ["e", "expenses", "Expenses"],
  ["c", "contacts", "Contacts"],
  ["p", "projects", "Projects"],
  ["h", "timesheets", "Time tracking"],
  ["a", "bank_transactions", "Bank transactions"],
  ["j", "journal_entries", "Journal entries"],
  ["r", "reports", "Insights"],
  ["s", "settings", "Settings"],
];

/**
 * Makes the whole app feel instant: every in-app link is prefetched the moment
 * the pointer rests on it (or it gets focus or is pressed), lists are warmed in
 * the local store, and the keyboard reaches everything.
 */
export function KeyboardShortcuts({ tenant }: { tenant: string }) {
  const router = useRouter();
  const t = useT();
  const { queryClient } = useLocalData();
  const [help, setHelp] = useState(false);
  const base = `/${tenant}`;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const intent = (e: Event, delay: number) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== location.origin) return;
      const path = a.pathname;
      if (!path.startsWith(base) || path.startsWith("/api/")) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        prefetchPage(router, `${path}${a.search}`);
        const [, , resource, id] = path.split("/");
        if (resource && !id) void warmRecords(queryClient, tenant, resource).catch(() => {});
      }, delay);
    };
    const over = (e: Event) => intent(e, 60);
    const now = (e: Event) => intent(e, 0);
    document.addEventListener("pointerover", over);
    document.addEventListener("focusin", over);
    document.addEventListener("pointerdown", now);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("focusin", over);
      document.removeEventListener("pointerdown", now);
    };
  }, [router, base, queryClient, tenant]);

  useEffect(() => {
    let chord = false;
    let chordTimer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable=true], [role=dialog]");
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (chord) {
        chord = false;
        clearTimeout(chordTimer);
        const hit = CHORDS.find(([key]) => key === e.key);
        if (!hit) return;
        // The chord owns this key: the list's own shortcuts (c, j, …) must not see it.
        e.preventDefault();
        e.stopImmediatePropagation();
        // Destinations outside the current menu (simple mode) still work; pages check permissions.
        router.push(hit[1] ? `${base}/${hit[1]}` : base);
        return;
      }
      if (e.key === "g") {
        e.stopImmediatePropagation();
        chord = true;
        chordTimer = setTimeout(() => (chord = false), 1200);
      } else if (e.key === "?") {
        e.preventDefault();
        setHelp(true);
      } else if (e.key === "u" && location.pathname.split("/").length > 3) {
        e.preventDefault();
        router.push(location.pathname.split("/").slice(0, 3).join("/"));
      }
    };
    // Capture phase, so chords are resolved before any page-level shortcut runs.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [router, base]);

  return (
    <Dialog open={help} onOpenChange={setHelp}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Keyboard shortcuts")}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {[
            ["⌘ K", t("Search and commands")],
            ["⌘ J", t("Ask Batzi")],
            ["j / k", t("Next / previous row")],
            ["↵", t("Open the selected row")],
            ["u", t("Back to the list")],
            ["/", t("Search this list")],
            ["c", t("Create")],
            ["?", t("Show shortcuts")],
            ...CHORDS.map(([key, , title]) => [`g ${key}`, t(title)]),
          ].map(([keys, what]) => (
            <div key={keys} className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{what}</span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
