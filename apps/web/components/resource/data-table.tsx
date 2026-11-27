import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { TermHint } from "@/components/i18n/term";
import { getT } from "@/lib/i18n/server";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatAmount } from "@batzio/core/format";
import type { Labels } from "@batzio/server/resources/client";
import type { FieldDef, Row } from "@batzio/server/resources/types";
import { cn } from "@/lib/utils";
import { CellValue, isNumericField } from "./cell";

/**
 * A glossary hint in a column header. Its explanation renders in place (outside the sort link, so
 * pressing it doesn't sort), and the wrapper resets the header's uppercase, nowrap and alignment.
 */
function HeaderHint({ term }: { term: string }) {
  return (
    <span className="inline-flex text-left font-normal tracking-normal whitespace-normal normal-case">
      <TermHint id={term} />
    </span>
  );
}

export async function DataTable({
  columns,
  rows,
  labels,
  tenant,
  hrefFor,
  sort,
  dir,
  sortHref,
  totals,
  empty,
  dense,
  extra,
}: {
  columns: FieldDef[];
  rows: Row[];
  labels: Labels;
  tenant: string;
  hrefFor?: (row: Row) => string | null;
  sort?: string;
  dir?: "asc" | "desc";
  sortHref?: (field: string) => string;
  totals?: Record<string, number>;
  empty?: React.ReactNode;
  dense?: boolean;
  /** Extra content appended to a column's cell, e.g. a “late” badge next to the status. */
  extra?: Record<string, (row: Row) => React.ReactNode>;
}) {
  const t = await getT();
  return (
    <div className="neu-card overflow-hidden">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => {
              const numeric = isNumericField(c);
              const active = sort === c.name;
              const sortable = !!sortHref && (c.sortable || c.list);
              return (
                <TableHead key={c.name} className={cn("h-10 text-xs font-semibold tracking-wide text-muted-foreground uppercase", numeric && "text-right")}>
                  {sortable ? (
                    <span className={cn("inline-flex items-center gap-1", numeric && "flex-row-reverse")}>
                      <Link href={sortHref!(c.name)} className={cn("inline-flex items-center gap-1 hover:text-foreground", numeric && "flex-row-reverse")}>
                        {c.label}
                        {active ? (
                          dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                        ) : (
                          <ArrowUpDown className="size-3 opacity-30" />
                        )}
                      </Link>
                      {c.term && <HeaderHint term={c.term} />}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      {c.label}
                      {c.term && <HeaderHint term={c.term} />}
                    </span>
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="h-40 text-center text-muted-foreground">
                {empty ?? t("Nothing here yet.")}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const href = hrefFor?.(row) ?? null;
              return (
                <TableRow key={String(row.id)} className={cn("relative", href && "cursor-pointer")}>
                  {columns.map((c, i) => (
                    <TableCell key={c.name} className={cn(dense ? "py-1.5" : "py-2.5", isNumericField(c) && "text-right", "max-w-80 truncate")}>
                      {i === 0 && href ? (
                        <Link href={href} className="after:absolute after:inset-0">
                          <CellValue field={c} value={row[c.name]} labels={labels} />
                        </Link>
                      ) : (
                        <CellValue field={c} value={row[c.name]} labels={labels} tenant={tenant} />
                      )}
                      {extra?.[c.name]?.(row)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })
          )}
        </TableBody>
        {totals && rows.length > 0 && (
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
  );
}

export async function Pager({ page, pages, total, hrefFor }: { page: number; pages: number; total: number; hrefFor: (page: number) => string }) {
  const t = await getT();
  if (pages <= 1) return <p className="text-xs text-muted-foreground">{t(total === 1 ? "{n} record" : "{n} records", { n: total })}</p>;
  return (
    <div className="flex items-center justify-between text-sm">
      <p className="text-xs text-muted-foreground">
        {t("{n} records · page {page} of {pages}", { n: total, page, pages })}
      </p>
      <div className="flex gap-1">
        <Link
          aria-disabled={page <= 1}
          href={hrefFor(Math.max(1, page - 1))}
          className={cn("rounded-md border px-3 py-1 hover:bg-muted", page <= 1 && "pointer-events-none opacity-40")}
        >
          {t("Previous")}
        </Link>
        <Link
          aria-disabled={page >= pages}
          href={hrefFor(Math.min(pages, page + 1))}
          className={cn("rounded-md border px-3 py-1 hover:bg-muted", page >= pages && "pointer-events-none opacity-40")}
        >
          {t("Next")}
        </Link>
      </div>
    </div>
  );
}
