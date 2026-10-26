import { Check, Minus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import { Figures } from "./figures";

/** One side of a comparison row: a mark (yes, no, coming soon, one day) and/or a short text. */
export interface Cell {
  mark?: "yes" | "no" | "soon" | "oneday";
  text?: string;
  /** Replaces the “Coming soon” / “One day” wording of the badge. */
  badge?: string;
}

export interface Row {
  label: string;
  them: Cell;
  us: Cell;
  /** Batzio is clearly ahead on this row. */
  win?: boolean;
}

export interface Group {
  title: string;
  icon: LucideIcon;
  rows: Row[];
}

async function CellView({ cell, side, win }: { cell: Cell; side: string; win?: boolean }) {
  const t = await getT();
  const badge =
    cell.mark === "soon" ? (
      <span className="bg-sun/25 text-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-semibold">{cell.badge ?? t("Coming soon")}</span>
    ) : cell.mark === "oneday" ? (
      <span className="bg-lilac/25 text-foreground inline-flex rounded-full px-2 py-0.5 text-xs font-semibold">{cell.badge ?? t("One day")}</span>
    ) : null;
  return (
    <div role="cell" className="min-w-0 text-sm leading-6">
      <span className="text-muted-foreground block text-xs font-semibold sm:hidden">{side}</span>
      {badge}
      <span className={cn("flex items-start gap-1.5", badge && "mt-1", win && "text-foreground font-semibold")}>
        {cell.mark === "yes" && <Check className="text-success mt-1 size-4 shrink-0" aria-label={cell.text ? undefined : t("Yes")} />}
        {cell.mark === "no" && <Minus className="text-muted-foreground mt-1 size-4 shrink-0" aria-label={t("Not included")} />}
        {cell.text && (
          <span className={cn(!win && "text-muted-foreground", cell.mark === "yes" && !win && "text-foreground")}>
            <Figures text={cell.text} />
          </span>
        )}
      </span>
    </div>
  );
}

/** The side-by-side tables, one per area; on phones each row stacks its label above the two sides. */
export async function ComparisonTable({ groups, them, us }: { groups: Group[]; them: string; us: string }) {
  const t = await getT();
  const COLS = "sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]";
  return (
    <div className="neu-card overflow-clip">
      <div aria-hidden className={cn("bg-card/95 sticky top-16 z-10 hidden gap-x-6 border-b px-6 py-3 backdrop-blur sm:grid", COLS)}>
        <span className="text-muted-foreground font-display col-start-2 text-lg font-semibold">{them}</span>
        <span className="font-display text-primary text-lg font-bold">{us}</span>
      </div>
      {groups.map((g, i) => (
        <section key={g.title} aria-labelledby={`compare-${i}`}>
          <h3 id={`compare-${i}`} className="bg-muted/50 font-display flex items-center gap-2 border-b px-4 py-2.5 font-semibold sm:px-6">
            <g.icon className="text-primary size-4" /> {g.title}
          </h3>
          <div role="table" aria-labelledby={`compare-${i}`}>
            <div role="row" className="sr-only">
              <span role="columnheader">{t("Criterion")}</span>
              <span role="columnheader">{them}</span>
              <span role="columnheader">{us}</span>
            </div>
            {g.rows.map((r) => (
              <div key={r.label} role="row" className={cn("grid grid-cols-2 gap-x-4 gap-y-2 border-b px-4 py-3 sm:gap-x-6 sm:px-6", COLS)}>
                <div role="rowheader" className="col-span-2 text-sm leading-6 font-medium sm:col-span-1">
                  {r.label}
                </div>
                <CellView cell={r.them} side={them} />
                <CellView cell={r.us} side={us} win={r.win} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
