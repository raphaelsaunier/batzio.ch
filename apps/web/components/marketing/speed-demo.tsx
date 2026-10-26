"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { TONE_CLASSES } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { useT } from "@batzio/i18n/react";

const ROWS = [
  { nr: "INV-2026-0007", customer: "Kaffeerösterei Lindenhof GmbH", total: "486.45", status: "Open", tone: "info" },
  { nr: "INV-2026-0006", customer: "Rhein Logistik AG", total: "291.85", status: "Partially paid", tone: "warning" },
  { nr: "INV-2026-0005", customer: "Rhein Logistik AG", total: "1’264.75", status: "Paid", tone: "success" },
  { nr: "INV-2026-0004", customer: "Studio Lugano SA", total: "1’891.75", status: "Draft", tone: "muted" },
  { nr: "INV-2026-0003", customer: "Atelier Morel Sàrl", total: "1’456.10", status: "Open", tone: "info" },
  { nr: "INV-2026-0002", customer: "Rhein Logistik AG", total: "3’272.20", status: "Partially paid", tone: "warning" },
  { nr: "INV-2026-0001", customer: "Kaffeerösterei Lindenhof GmbH", total: "2’399.80", status: "Paid", tone: "success" },
] as const;


/**
 * The landing page's taste of the app: a list that filters as you type and
 * follows the keyboard (j/k, ↑/↓, /, ↵).
 */
export function SpeedDemo() {
  const t = useT();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [opened, setOpened] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const visible = useRef(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? ROWS.filter((r) => `${r.nr} ${r.customer} ${t(r.status)}`.toLowerCase().includes(needle)) : ROWS;
  }, [q, t]);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => (visible.current = entry.isIntersecting), { threshold: 0.4 });
    if (box.current) observer.observe(box.current);
    const onKey = (e: KeyboardEvent) => {
      if (!visible.current || e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        search.current?.focus();
        return;
      }
      if (typing && e.target !== search.current) return;
      if (e.key === "Escape") return search.current?.blur();
      const down = e.key === "ArrowDown" || (e.key === "j" && !typing);
      const up = e.key === "ArrowUp" || (e.key === "k" && !typing);
      if (down || up) {
        e.preventDefault();
        setCursor((c) => Math.max(0, Math.min(c + (down ? 1 : -1), Number(box.current?.dataset.count ?? 1) - 1)));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const nr = box.current?.querySelector<HTMLElement>("[data-cursor='true']")?.dataset.nr;
        if (nr) setOpened(nr);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={box} data-count={rows.length} className="neu-panel overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Search className="text-muted-foreground size-4" />
        <input
          ref={search}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(0);
          }}
          placeholder={t("Type to filter: “rhein”, “paid”, “0003”…")}
          aria-label={t("Search this list")}
          className="placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <kbd className="text-muted-foreground rounded border px-1.5 font-mono text-[11px]">/</kbd>
      </div>
      <ul className="divide-y" role="listbox" aria-label={t("Invoices")}>
        {rows.map((r, i) => (
          <li
            key={r.nr}
            role="option"
            aria-selected={i === cursor}
            data-cursor={i === cursor}
            data-nr={r.nr}
            onMouseEnter={() => setCursor(i)}
            onClick={() => setOpened(r.nr)}
            className={cn("flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors", i === cursor && "bg-accent/70")}
          >
            <span className="w-28 shrink-0 font-mono text-xs font-semibold">{r.nr}</span>
            <span className="text-muted-foreground min-w-0 flex-1 truncate">{r.customer}</span>
            <Badge variant="outline" className={cn("hidden sm:inline-flex", TONE_CLASSES[r.tone])}>
              {t(r.status)}
            </Badge>
            <span className="num w-20 text-right font-semibold">{r.total}</span>
          </li>
        ))}
        {!rows.length && <li className="text-muted-foreground px-4 py-6 text-center text-sm">{t("Nothing matches.")}</li>}
      </ul>
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5 text-xs">
        <span className="flex gap-3">
          <span>
            <kbd className="rounded border px-1 font-mono">j</kbd> <kbd className="rounded border px-1 font-mono">k</kbd> {t("move")}
          </span>
          <span>
            <kbd className="rounded border px-1 font-mono">↵</kbd> {t("open")}
          </span>
        </span>
        <span className="num" aria-live="polite">
          {opened ? t("{nr} opened — no spinner, no wait.", { nr: opened }) : t("Try the keyboard.")}
        </span>
      </div>
    </div>
  );
}
