"use client";

import { Download, Filter, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { FieldDef } from "@batzio/server/resources/types";
import { useT } from "@batzio/i18n/react";

const ALL = "__all";

export function ListToolbar({
  filters,
  exportHref,
  archivable,
  children,
}: {
  filters: FieldDef[];
  exportHref?: string;
  archivable?: boolean;
  children?: React.ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();

  const push = (mutate: (p: URLSearchParams) => void) => {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  };

  useEffect(() => {
    if ((params.get("q") ?? "") === q) return;
    const t = setTimeout(() => push((p) => (q ? p.set("q", q) : p.delete("q"))), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const active = filters.filter((f) => params.get(f.name));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className="w-full sm:w-72">
        <InputGroupAddon>{pending ? <Spinner /> : <Search />}</InputGroupAddon>
        <InputGroupInput placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
        {q && (
          <InputGroupAddon align="inline-end">
            <button type="button" onClick={() => setQ("")} aria-label={t("Clear search")}>
              <X className="size-4" />
            </button>
          </InputGroupAddon>
        )}
      </InputGroup>
      {filters.map((f) => (
        <Select
          key={f.name}
          value={params.get(f.name) ?? ALL}
          onValueChange={(v) => push((p) => (v === ALL ? p.delete(f.name) : p.set(f.name, v)))}
        >
          <SelectTrigger size="sm" className="h-8 min-w-32">
            <Filter className="size-3.5 opacity-60" />
            <SelectValue placeholder={f.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All {f.label.toLowerCase()}</SelectItem>
            {f.type === "boolean" ? (
              <>
                <SelectItem value="true">{f.label}: yes</SelectItem>
                <SelectItem value="false">{f.label}: no</SelectItem>
              </>
            ) : (
              (f.options ?? []).map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      ))}
      {archivable && (
        <Select
          value={params.get("archived") ?? ALL}
          onValueChange={(v) => push((p) => (v === ALL ? p.delete("archived") : p.set("archived", v)))}
        >
          <SelectTrigger size="sm" className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("Active")}</SelectItem>
            <SelectItem value="include">{t("Active & archived")}</SelectItem>
            <SelectItem value="only">{t("Archived")}</SelectItem>
          </SelectContent>
        </Select>
      )}
      {active.length > 0 && (
        <Button variant="ghost" size="sm" onClick={() => push((p) => active.forEach((f) => p.delete(f.name)))}>
          <X /> Reset
        </Button>
      )}
      <div className="ml-auto flex items-center gap-2">
        {children}
        {exportHref && (
          <Button variant="outline" size="sm" asChild>
            <a href={`${exportHref}${exportHref.includes("?") ? "&" : "?"}${new URLSearchParams([...params.entries()].filter(([k]) => k !== "page")).toString()}`}>
              <Download /> Excel
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
