"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TFunction } from "@batzio/i18n";
import { useT } from "@batzio/i18n/react";

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function presets(t: TFunction): { id: string; label: string; from: string; to: string }[] {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const q = Math.floor(m / 3);
  const range = (y1: number, m1: number, y2: number, m2: number) => ({ from: iso(new Date(Date.UTC(y1, m1, 1))), to: iso(new Date(Date.UTC(y2, m2 + 1, 0))) });
  return [
    { id: "year", label: t("Year {y}", { y }), ...range(y, 0, y, 11) },
    { id: "last_year", label: t("Year {y}", { y: y - 1 }), ...range(y - 1, 0, y - 1, 11) },
    { id: "quarter", label: `Q${q + 1} ${y}`, ...range(y, q * 3, y, q * 3 + 2) },
    { id: "last_quarter", label: q === 0 ? `Q4 ${y - 1}` : `Q${q} ${y}`, ...(q === 0 ? range(y - 1, 9, y - 1, 11) : range(y, (q - 1) * 3, y, (q - 1) * 3 + 2)) },
    { id: "month", label: t("This month"), ...range(y, m, y, m) },
    { id: "last_month", label: t("Last month"), ...(m === 0 ? range(y - 1, 11, y - 1, 11) : range(y, m - 1, y, m - 1)) },
  ];
}

export function PeriodPicker({ mode = "range", from, to }: { mode?: "range" | "date"; from?: string; to?: string }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [start, setStart] = useState(from ?? "");
  const [end, setEnd] = useState(to ?? "");
  const all = presets(t);
  const current = all.find((p) => p.from === from && p.to === to)?.id ?? "custom";

  const apply = (f: string, t: string) => {
    const next = new URLSearchParams(params.toString());
    if (mode === "date") next.set("date", t);
    else {
      next.set("from", f);
      next.set("to", t);
    }
    router.replace(`${pathname}?${next.toString()}`);
  };

  if (mode === "date") {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply(end, end);
        }}
      >
        <span className="text-sm text-muted-foreground">As of</span>
        <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-8 w-40 bg-background" />
        <Button type="submit" size="sm" variant="outline">
          {t("Apply")}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={current}
        onValueChange={(id) => {
          const p = all.find((x) => x.id === id);
          if (p) {
            setStart(p.from);
            setEnd(p.to);
            apply(p.from, p.to);
          }
        }}
      >
        <SelectTrigger className="h-8 w-40 bg-background">
          <SelectValue placeholder={t("Custom period")} />
        </SelectTrigger>
        <SelectContent>
          {all.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.label}
            </SelectItem>
          ))}
          <SelectItem value="custom" disabled>
            {t("Custom")}
          </SelectItem>
        </SelectContent>
      </Select>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply(start, end);
        }}
      >
        <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-8 w-40 bg-background" aria-label={t("From")} />
        <span className="text-muted-foreground">–</span>
        <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-8 w-40 bg-background" aria-label={t("To")} />
        <Button type="submit" size="sm" variant="outline">
          {t("Apply")}
        </Button>
      </form>
    </div>
  );
}
