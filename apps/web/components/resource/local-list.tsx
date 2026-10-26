"use client";

import { and, eq, gt, gte, ilike, inArray, isNull, lt, lte, not, or, useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Filter, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Batzi } from "@/components/fun/batzi";
import { TermHint } from "@/components/i18n/term";
import { useLocalData } from "@/components/local/local-data";
import { prefetchPage } from "@/components/local/keyboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT } from "@batzio/i18n/react";
import { daysBetween, formatAmount, today } from "@batzio/core/format";
import type { FieldDef, Row } from "@batzio/server/resources/types";
import { fetchRecords, MAX_LOCAL_ROWS, recordsCollection, recordsKey, type Labels, type LocalRow } from "@/lib/local/store";
import { cn } from "@/lib/utils";
import { CellValue, isNumericField } from "./cell";

const ALL = "__all";
const STEP = 100;

export interface LocalListProps {
  tenant: string;
  resource: string;
  columns: FieldDef[];
  fields: FieldDef[];
  statusField?: FieldDef;
  filterFields: FieldDef[];
  defaultSort: { field: string; dir: "asc" | "desc" };
  canCreate: boolean;
  label: string;
  softDelete: boolean;
  empty: { title: string; text: string; mood?: string } | null;
  /** Statuses that get a “late” badge once the due date has passed. */
  lateStatuses?: string[];
  /** URL parameters the page was opened with (status, filters, sort, q). */
  params: Record<string, string>;
  /** Server-rendered first page, only on full page loads (so the HTML is complete). */
  initial: { rows: Row[]; labels: Labels; total: number } | null;
  /** When the server rendered the page: a router refresh (after a change) makes the list re-sync. */
  renderedAt: number;
}

/** Turns a URL value into the stored representation of a field (Rappen, 0/1, numbers). */
function stored(field: FieldDef, raw: string): unknown {
  switch (field.type) {
    case "money":
      return Math.round(Number(raw) * 100);
    case "boolean":
      return raw === "true" || raw === "1" ? 1 : 0;
    case "int":
    case "decimal":
    case "percent":
    case "ref":
      return Number(raw);
    default:
      return raw;
  }
}

type Clause = { field: FieldDef; op: string; raw: string };

function clausesFrom(params: Record<string, string>, fields: FieldDef[]): Clause[] {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const out: Clause[] = [];
  for (const [key, raw] of Object.entries(params)) {
    if (["q", "sort", "dir", "page", "per_page", "limit", "offset", "tenant"].includes(key) || raw === "") continue;
    let field = byName.get(key);
    let op = "eq";
    if (!field) {
      const m = /^(.*)_(gte|lte|gt|lt|in|ne|null)$/.exec(key);
      if (!m) continue;
      field = byName.get(m[1]);
      op = m[2];
    }
    if (!field || field.type === "json" || field.type === "text") continue;
    out.push({ field, op, raw });
  }
  return out;
}

/**
 * Any module's list, rendered from the local copy (TanStack DB): opening it,
 * searching, filtering and sorting never wait for the network. The copy is
 * revalidated in the background on every visit.
 */
export function LocalResourceList(props: LocalListProps) {
  const { tenant, resource, columns, fields, statusField, filterFields, defaultSort, canCreate, label, softDelete, empty, lateStatuses, initial, renderedAt } = props;
  const t = useT();
  const router = useRouter();
  const { queryClient } = useLocalData();
  const collection = useMemo(() => recordsCollection(queryClient, tenant, resource), [queryClient, tenant, resource]);
  const snapshot = useQuery({ queryKey: recordsKey(tenant, resource), queryFn: ({ signal }) => fetchRecords(tenant, resource, signal) });

  const [q, setQ] = useState(props.params.q ?? "");
  const [filters, setFilters] = useState<Record<string, string>>(() => {
    const { q: _q, sort: _s, dir: _d, page: _p, ...rest } = props.params;
    return rest;
  });
  const [sort, setSort] = useState(props.params.sort ?? defaultSort.field);
  const [dir, setDir] = useState<"asc" | "desc">((props.params.dir as "asc" | "desc") ?? (props.params.sort ? "asc" : defaultSort.dir));
  const [limit, setLimit] = useState(STEP);
  const [cursor, setCursor] = useState(-1);
  const search = useRef<HTMLInputElement>(null);
  const base = `/${tenant}/${resource}`;

  // Revalidate on every visit and after every refresh; the local copy is shown meanwhile.
  useEffect(() => {
    void collection.utils.refetch();
  }, [collection, renderedAt]);

  // Keep the address shareable without a server round trip.
  useEffect(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    if (q) p.set("q", q);
    if (sort !== defaultSort.field || dir !== defaultSort.dir) {
      p.set("sort", sort);
      p.set("dir", dir);
    }
    const next = `${base}${p.size ? `?${p}` : ""}`;
    if (next !== `${location.pathname}${location.search}`) window.history.replaceState(window.history.state, "", next);
    setCursor(-1);
    setLimit(STEP);
  }, [filters, q, sort, dir, base, defaultSort.field, defaultSort.dir]);

  const clauses = useMemo(() => clausesFrom(filters, fields), [filters, fields]);
  const needle = q.trim().toLowerCase();

  const live = useLiveQuery({
    query: (qb) => {
      let query = qb.from({ r: collection });
      for (const { field, op, raw } of clauses) {
        query = query.where(({ r }) => {
          const col = (r as unknown as Record<string, Parameters<typeof eq>[0]>)[field.name];
          if (field.type === "tags") return ilike(col as never, `%${raw}%`);
          switch (op) {
            case "gte":
              return gte(col, stored(field, raw));
            case "lte":
              return lte(col, stored(field, raw));
            case "gt":
              return gt(col, stored(field, raw));
            case "lt":
              return lt(col, stored(field, raw));
            case "ne":
              return or(isNull(col), not(eq(col, stored(field, raw))));
            case "null":
              return raw === "false" || raw === "0" ? not(isNull(col)) : isNull(col);
            case "in":
              return inArray(col, raw.split(",").map((v) => stored(field, v.trim())));
            default:
              return eq(col, stored(field, raw));
          }
        });
      }
      if (needle) query = query.where(({ r }) => (/^\d+$/.test(needle) ? or(ilike(r._search, `%${needle}%`), eq(r.id, Number(needle))) : ilike(r._search, `%${needle}%`)));
      return query
        .orderBy(({ r }) => (r as unknown as Record<string, Parameters<typeof eq>[0]>)[sort], dir)
        .orderBy(({ r }) => r.id, "desc");
    },
  });

  const ready = live.isReady && snapshot.data !== undefined;
  const rows: Row[] = ready ? (live.data as LocalRow[]) : (initial?.rows ?? []);
  const labels: Labels = ready ? snapshot.data!.labels : (initial?.labels ?? {});
  const total = ready ? rows.length : (initial?.total ?? 0);
  const loading = !ready && !initial;
  const truncated = ready && !snapshot.data!.complete;

  const money = columns.filter((c) => c.type === "money").map((c) => c.name);
  const totals = useMemo(() => {
    if (!money.length || !rows.length) return null;
    const sums: Record<string, number> = {};
    for (const m of money) sums[m] = rows.reduce((s, r) => s + (Number(r[m]) || 0), 0);
    return sums;
  }, [rows, money.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = rows.slice(0, limit);
  const now = today();
  const status = statusField ? (filters[statusField.name] ?? null) : null;
  const setFilter = (name: string, value: string | null) =>
    setFilters((f) => {
      const next = { ...f };
      if (value === null) delete next[name];
      else next[name] = value;
      return next;
    });

  // Superhuman-style keys: j/k (or ↓/↑) move, Enter opens, / searches, c creates.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest("input, textarea, select, [contenteditable=true], [role=dialog]");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        search.current?.focus();
        return;
      }
      if (e.key === "Escape" && target === search.current) {
        search.current?.blur();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, shown.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if ((e.key === "Enter" || e.key === "o") && cursor >= 0 && shown[cursor]) {
        e.preventDefault();
        router.push(`${base}/${shown[cursor].id}`);
      } else if (e.key === "c" && canCreate) {
        e.preventDefault();
        router.push(`${base}/new`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, cursor, base, router, canCreate]);

  // Prefetch the row under the keyboard cursor, then keep it in view.
  useEffect(() => {
    const row = shown[cursor];
    if (!row) return;
    prefetchPage(router, `${base}/${row.id}`);
    document.querySelector(`[data-row="${row.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render more rows as the end of the table comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + STEP);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [rows.length]);

  return (
    <div className="space-y-4">
      {statusField?.options && (
        <div className="-mt-1 flex gap-1 overflow-x-auto border-b">
          {[{ value: null as string | null, label: t("All") }, ...statusField.options].map((o) => {
            const active = status === o.value;
            return (
              <button
                key={o.value ?? "all"}
                type="button"
                onClick={() => setFilter(statusField.name, o.value)}
                className={cn(
                  "border-b-2 px-3 pb-2.5 text-sm whitespace-nowrap transition-colors",
                  active ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>{snapshot.isFetching && !ready ? <Spinner /> : <Search />}</InputGroupAddon>
          <InputGroupInput ref={search} placeholder={t("Search…")} value={q} onChange={(e) => setQ(e.target.value)} />
          {q ? (
            <InputGroupAddon align="inline-end">
              <button type="button" onClick={() => setQ("")} aria-label={t("Clear search")}>
                <X className="size-4" />
              </button>
            </InputGroupAddon>
          ) : (
            <InputGroupAddon align="inline-end">
              <kbd className="text-muted-foreground rounded border px-1.5 text-[10px]">/</kbd>
            </InputGroupAddon>
          )}
        </InputGroup>
        {filterFields.map((f) => (
          <Select key={f.name} value={filters[f.name] ?? ALL} onValueChange={(v) => setFilter(f.name, v === ALL ? null : v)}>
            <SelectTrigger size="sm" className="h-8 min-w-32">
              <Filter className="size-3.5 opacity-60" />
              <SelectValue placeholder={f.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{f.label}</SelectItem>
              {f.type === "boolean" ? (
                <>
                  <SelectItem value="true">{f.label}: {t("Yes")}</SelectItem>
                  <SelectItem value="false">{f.label}: {t("No")}</SelectItem>
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
        <div className="ml-auto flex items-center gap-2">
          {softDelete && (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`${base}?archived=include`}>{t("Show archived")}</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <a href={`/api/v1/${resource}?format=xlsx&tenant=${tenant}`}>
              <Download /> {t("Export to Excel")}
            </a>
          </Button>
        </div>
      </div>

      <div className="neu-card overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
              {columns.map((c) => {
                const numeric = isNumericField(c);
                const active = sort === c.name;
                return (
                  <TableHead key={c.name} className={cn("h-10 text-xs font-semibold tracking-wide text-muted-foreground uppercase", numeric && "text-right")}>
                    <span className={cn("inline-flex items-center gap-1", numeric && "flex-row-reverse")}>
                      <button
                        type="button"
                        onClick={() => {
                          if (active) setDir(dir === "asc" ? "desc" : "asc");
                          else {
                            setSort(c.name);
                            setDir("asc");
                          }
                        }}
                        className={cn("inline-flex items-center gap-1 uppercase hover:text-foreground", numeric && "flex-row-reverse")}
                      >
                        {c.label}
                        {active ? dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-30" />}
                      </button>
                      {c.term && <TermHint id={c.term} className="normal-case" />}
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }, (_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  {columns.map((c) => (
                    <TableCell key={c.name} className="py-3">
                      <div className="bg-muted h-3.5 w-3/4 animate-pulse rounded" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : shown.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="h-40 text-center text-muted-foreground">
                  {q || clauses.length ? (
                    t("Nothing found")
                  ) : (
                    <div className="flex flex-col items-center gap-3 py-6">
                      <Batzi mood={(empty?.mood as "sleepy") ?? "sleepy"} className="size-16" />
                      <div>
                        <p className="font-display text-foreground text-base font-semibold">{empty?.title ?? t("Nothing here yet")}</p>
                        {empty?.text && <p className="mx-auto max-w-sm text-sm">{empty.text}</p>}
                      </div>
                      {canCreate && (
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`${base}/new`}>
                            <Plus /> {t("Create the first one")}
                          </Link>
                        </Button>
                      )}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              shown.map((row, index) => {
                const href = `${base}/${row.id}`;
                const due = row.due_date as string | null;
                const late = statusField && lateStatuses?.includes(String(row[statusField.name])) && due && due < now ? daysBetween(due, now) : 0;
                return (
                  <TableRow
                    key={String(row.id)}
                    data-row={String(row.id)}
                    className={cn("relative cursor-pointer", index === cursor && "bg-accent/70 outline outline-2 -outline-offset-2 outline-primary/40")}
                    onMouseEnter={() => setCursor(index)}
                  >
                    {columns.map((c, i) => (
                      <TableCell key={c.name} className={cn("py-2.5", isNumericField(c) && "text-right", "max-w-80 truncate")}>
                        {i === 0 ? (
                          <Link href={href} className="after:absolute after:inset-0">
                            <CellValue field={c} value={row[c.name]} labels={labels} />
                          </Link>
                        ) : (
                          <CellValue field={c} value={row[c.name]} labels={labels} tenant={tenant} />
                        )}
                        {late && c.name === statusField?.name ? (
                          <Badge variant="outline" className="border-destructive/25 bg-destructive/10 text-destructive ml-1.5 font-medium">
                            {t("late {n}d", { n: late })}
                          </Badge>
                        ) : null}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
          {totals && shown.length > 0 && (
            <TableFooter className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                {columns.map((c, i) => (
                  <TableCell key={c.name} className={cn("py-2.5 font-semibold", isNumericField(c) && "text-right num")}>
                    {i === 0 ? t("Total") : c.name in totals ? formatAmount(totals[c.name]) : ""}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      <div ref={sentinel} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {t(total === 1 ? "{n} record" : "{n} records", { n: total })}
          {truncated && ` · ${t("the latest {n} are on this device", { n: MAX_LOCAL_ROWS })}`}
        </span>
        <span className="hidden gap-3 sm:flex">
          <span><kbd className="rounded border px-1">j</kbd> <kbd className="rounded border px-1">k</kbd> {t("move")}</span>
          <span><kbd className="rounded border px-1">↵</kbd> {t("open")}</span>
          {canCreate && <span><kbd className="rounded border px-1">c</kbd> {t("create")}</span>}
          <span><kbd className="rounded border px-1">/</kbd> {t("search")}</span>
        </span>
      </div>
    </div>
  );
}
