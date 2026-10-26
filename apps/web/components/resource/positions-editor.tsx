"use client";

import { ArrowDown, ArrowUp, Calculator, Minus, Package, Percent, Plus, SeparatorHorizontal, Trash2, Type } from "lucide-react";
import { useTransition } from "react";
import { itemDefaultsAction } from "@/app/(app)/[tenant]/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { calculateDocument, type VatMode } from "@batzio/core/calc/documents";
import { formatAmount, formatDecimal } from "@batzio/core/format";
import { cn } from "@/lib/utils";
import { moveRow, newKey, SummaryLine, type ChildRow } from "./children-editor";
import type { FormLabels } from "./field-input";
import { RefSelect } from "./ref-select";
import { useT } from "@batzio/i18n/react";

export interface TaxOption {
  id: number;
  code: string;
  rate: number;
  type: "sales" | "purchase";
}

const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/['’\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  item: <Package className="size-3.5" />,
  custom: <Calculator className="size-3.5" />,
  text: <Type className="size-3.5" />,
  subtotal: <Minus className="size-3.5" />,
  discount: <Percent className="size-3.5" />,
  pagebreak: <SeparatorHorizontal className="size-3.5" />,
};

export function PositionsEditor({
  rows,
  onChange,
  tenant,
  labels,
  onLabels,
  disabled,
  vatMode,
  currency,
  rounding,
  taxes,
  purchase,
}: {
  rows: ChildRow[];
  onChange: (rows: ChildRow[]) => void;
  tenant: string;
  labels: FormLabels;
  onLabels: (key: string, labels: Record<string, string>) => void;
  disabled?: boolean;
  vatMode: VatMode;
  currency: string;
  rounding: number;
  taxes: TaxOption[];
  purchase?: boolean;
}) {
  const t = useT();
  const [, start] = useTransition();
  const taxList = taxes.filter((t) => t.type === (purchase ? "purchase" : "sales"));
  const defaultTax = taxList.find((t) => t.code === (purchase ? "VM81" : "UN81")) ?? taxList[0];
  const rateOf = (id: unknown) => taxes.find((t) => t.id === Number(id))?.rate ?? 0;

  const calc = calculateDocument(
    rows.map((r) => ({
      type: String(r.type ?? "custom"),
      quantity: num(r.quantity),
      unit_price: num(r.unit_price),
      discount_percent: num(r.discount_percent),
      tax_id: vatMode === "none" ? null : r.tax_id ? Number(r.tax_id) : null,
      tax_rate: vatMode === "none" ? 0 : rateOf(r.tax_id),
      is_optional: !!r.is_optional,
    })),
    vatMode,
    rounding,
  );

  const set = (index: number, patch: Record<string, unknown>) => onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const add = (type: string) => {
    const base: ChildRow = { _key: newKey(), type };
    if (type === "item" || type === "custom") Object.assign(base, { quantity: "1", unit_price: "", tax_id: vatMode === "none" ? null : (defaultTax?.id ?? null) });
    if (type === "discount") Object.assign(base, { text: t("Discount"), discount_percent: "5" });
    onChange([...rows, base]);
  };
  const pickItem = (index: number, id: number | null, label: string | null) => {
    set(index, { item_id: id });
    if (!id) return;
    if (label) onLabels(`positions.${rows[index]._key}.item_id`, { [id]: label });
    start(async () => {
      const d = await itemDefaultsAction(tenant, id, purchase);
      if (!d) return;
      onChange(
        rows.map((r, i) =>
          i === index
            ? {
                ...r,
                item_id: id,
                code: d.code,
                text: d.text,
                unit_name: d.unit_name,
                unit_price: String(d.unit_price),
                tax_id: vatMode === "none" ? null : (d.tax_id ?? r.tax_id ?? defaultTax?.id ?? null),
              }
            : r,
        ),
      );
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="hidden grid-cols-[2rem_minmax(0,1fr)_5rem_4.5rem_6.5rem_4.5rem_7rem_7rem_2.5rem] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase xl:grid">
        <span>#</span>
        <span>{t("Description")}</span>
        <span className="text-right">{t("Qty")}</span>
        <span>{t("Unit")}</span>
        <span className="text-right">{t("Price")}</span>
        <span className="text-right">{t("Disc. %")}</span>
        <span>{t("VAT")}</span>
        <span className="text-right">{t("Total")}</span>
        <span />
      </div>
      <div className="divide-y">
        {rows.map((row, i) => {
          const type = String(row.type ?? "custom");
          const line = calc.lines[i];
          const priced = type === "item" || type === "custom";
          return (
            <div
              key={row._key}
              className={cn(
                "group grid grid-cols-[2rem_minmax(0,1fr)_2.5rem] items-start gap-2 px-3 py-2 xl:grid-cols-[2rem_minmax(0,1fr)_5rem_4.5rem_6.5rem_4.5rem_7rem_7rem_2.5rem]",
                !!row.is_optional && "bg-muted/30",
                type === "subtotal" && "bg-accent/40",
              )}
            >
              <div className="flex flex-col items-center gap-0.5 pt-1.5 text-xs text-muted-foreground">
                <span title={type}>{TYPE_ICON[type]}</span>
                {!disabled && (
                  <span className="flex opacity-0 transition-opacity group-hover:opacity-100">
                    <button type="button" onClick={() => onChange(moveRow(rows, i, -1))} aria-label={t("Move up")}>
                      <ArrowUp className="size-3" />
                    </button>
                    <button type="button" onClick={() => onChange(moveRow(rows, i, 1))} aria-label={t("Move down")}>
                      <ArrowDown className="size-3" />
                    </button>
                  </span>
                )}
              </div>

              {priced ? (
                <>
                  <div className="space-y-1.5">
                    {type === "item" && (
                      <RefSelect
                        tenant={tenant}
                        resource="items"
                        value={row.item_id ? Number(row.item_id) : null}
                        label={labels[`positions.${row._key}.item_id`]?.[String(row.item_id)] ?? labels["positions.item_id"]?.[String(row.item_id)]}
                        onChange={(id, label) => pickItem(i, id, label)}
                        placeholder={t("Choose product or service…")}
                        disabled={disabled}
                        compact
                      />
                    )}
                    <Textarea
                      value={String(row.text ?? "")}
                      onChange={(e) => set(i, { text: e.target.value })}
                      placeholder={t("Description")}
                      rows={1}
                      disabled={disabled}
                      className="min-h-8 resize-y py-1.5 text-sm"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox checked={!!row.is_optional} onCheckedChange={(v) => set(i, { is_optional: !!v })} disabled={disabled} className="size-3.5" />
                      Optional (not included in total)
                    </label>
                  </div>
                  <div className="col-span-2 col-start-2 grid grid-cols-[4rem_4rem_5.5rem_3.5rem_minmax(6rem,1fr)] gap-2 xl:col-span-1 xl:col-start-auto xl:contents">
                    <Input value={String(row.quantity ?? "")} onChange={(e) => set(i, { quantity: e.target.value })} inputMode="decimal" disabled={disabled} className="h-8 text-right num" aria-label="Quantity" />
                    <Input value={String(row.unit_name ?? "")} onChange={(e) => set(i, { unit_name: e.target.value })} disabled={disabled} className="h-8" aria-label={t("Unit")} />
                    <Input value={String(row.unit_price ?? "")} onChange={(e) => set(i, { unit_price: e.target.value })} inputMode="decimal" placeholder="0.00" disabled={disabled} className="h-8 text-right num" aria-label="Unit price" />
                    <Input value={String(row.discount_percent ?? "")} onChange={(e) => set(i, { discount_percent: e.target.value })} inputMode="decimal" placeholder="0" disabled={disabled} className="h-8 text-right num" aria-label={t("Discount")} />
                    <select
                      value={vatMode === "none" ? "" : String(row.tax_id ?? "")}
                      onChange={(e) => set(i, { tax_id: e.target.value ? Number(e.target.value) : null })}
                      disabled={disabled || vatMode === "none"}
                      className="field h-8 border px-2 text-sm"
                      aria-label={t("VAT")}
                    >
                      <option value="">—</option>
                      {taxList.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.code} · {formatDecimal(t.rate, 1)}%
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className={cn("col-start-2 pt-1.5 text-right text-sm font-medium num xl:col-start-auto", !!row.is_optional && "text-muted-foreground line-through")}>
                    {formatAmount(line?.total ?? 0)}
                  </div>
                </>
              ) : type === "text" ? (
                <Textarea
                  value={String(row.text ?? "")}
                  onChange={(e) => set(i, { text: e.target.value })}
                  placeholder={t("Heading or text block")}
                  rows={1}
                  disabled={disabled}
                  className="min-h-8 resize-y py-1.5 font-medium xl:col-span-7"
                />
              ) : type === "subtotal" ? (
                <div className="flex justify-between pt-1.5 text-sm font-semibold xl:col-span-7">
                  <span>{t("Subtotal")}</span>
                  <span className="num">{formatAmount(line?.subtotal ?? 0)}</span>
                </div>
              ) : type === "discount" ? (
                <div className="grid grid-cols-[minmax(0,1fr)_5rem_6.5rem_7rem] items-center gap-2 xl:col-span-7">
                  <Input value={String(row.text ?? "")} onChange={(e) => set(i, { text: e.target.value })} placeholder={t("Discount")} disabled={disabled} className="h-8" />
                  <Input value={String(row.discount_percent ?? "")} onChange={(e) => set(i, { discount_percent: e.target.value, unit_price: "" })} placeholder="%" inputMode="decimal" disabled={disabled} className="h-8 text-right num" aria-label="Discount percent" />
                  <Input value={String(row.unit_price ?? "")} onChange={(e) => set(i, { unit_price: e.target.value, discount_percent: "" })} placeholder="or amount" inputMode="decimal" disabled={disabled} className="h-8 text-right num" aria-label="Discount amount" />
                  <span className="text-right text-sm font-medium text-destructive num">{formatAmount(line?.total ?? 0)}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 pt-1.5 text-xs text-muted-foreground xl:col-span-7">
                  <span className="h-px flex-1 border-t border-dashed" /> page break <span className="h-px flex-1 border-t border-dashed" />
                </div>
              )}

              <div className="row-start-1 flex justify-end xl:row-start-auto">
                {!disabled && (
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={t("Remove position")}>
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
        {rows.length === 0 && <div className="px-4 py-8 text-center text-sm text-muted-foreground">{t("Add products, services or free positions.")}</div>}
      </div>
      <div className="flex flex-col gap-4 border-t bg-muted/20 p-3 sm:flex-row sm:items-start sm:justify-between">
        {!disabled ? (
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" onClick={() => add("item")}>
              <Plus /> {t("Product / service")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => add("custom")}>
              <Calculator /> {t("Free position")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => add("text")}>
              <Type /> {t("Text")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => add("subtotal")}>
              <Minus /> {t("Subtotal")}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => add("discount")}>
              <Percent /> {t("Discount")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => add("pagebreak")}>
              <SeparatorHorizontal /> {t("Page break")}
            </Button>
          </div>
        ) : (
          <span />
        )}
        <div className="min-w-64 space-y-1 rounded-lg border bg-card p-3">
          <SummaryLine label={vatMode === "incl" ? t("Total excl. VAT") : t("Net total")} value={calc.totalNet} muted />
          {calc.vat
            .filter((b) => b.rate > 0)
            .map((b) => (
              <SummaryLine key={`${b.taxId}-${b.rate}`} label={t("VAT {rate}% on {base}", { rate: formatDecimal(b.rate, 1), base: formatAmount(b.base) })} value={b.vat} muted />
            ))}
          {calc.rounding !== 0 && <SummaryLine label={t("Rounding")} value={calc.rounding} muted />}
          <div className="my-1 border-t" />
          <SummaryLine label={t("Total {currency}", { currency })} value={calc.total} strong />
        </div>
      </div>
    </div>
  );
}
