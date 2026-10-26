"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatAmount, formatDecimal } from "@batzio/core/format";
import { toCents } from "@batzio/core/money";
import type { ChildDef, FieldDef } from "@batzio/server/resources/types";
import { cn } from "@/lib/utils";
import { FieldInput, type FormLabels, type FormValues } from "./field-input";
import { useT } from "@batzio/i18n/react";

export type ChildRow = FormValues & { _key: string };

let keySeq = 0;
export const newKey = () => `k${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export function moveRow<T>(rows: T[], index: number, delta: number): T[] {
  const next = [...rows];
  const target = index + delta;
  if (target < 0 || target >= rows.length) return rows;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Generic editable table for child rows (bill lines, journal lines). */
export function ChildrenEditor({
  child,
  rows,
  onChange,
  tenant,
  labels,
  onLabels,
  disabled,
  errors,
  footer,
}: {
  child: ChildDef;
  rows: ChildRow[];
  onChange: (rows: ChildRow[]) => void;
  tenant: string;
  labels: FormLabels;
  onLabels: (key: string, labels: Record<string, string>) => void;
  disabled?: boolean;
  errors?: Record<string, string>;
  footer?: React.ReactNode;
}) {
  const t = useT();
  const columns = child.fields.filter((f) => !f.hidden && !(f.readOnly && f.type !== "money"));
  const update = (index: number, name: string, value: unknown) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, [name]: value } : r)));
  const labelKey = (rowKey: string, field: FieldDef) => `${child.name}.${rowKey}.${field.name}`;
  const width = (f: FieldDef) =>
    f.type === "money" || f.type === "decimal" || f.type === "percent" ? "w-28" : f.type === "ref" ? "min-w-48" : "min-w-40";

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="w-8 px-2 py-2" />
            {columns.map((f) => (
              <th key={f.name} className={cn("px-2 py-2 text-left font-semibold", width(f), f.type === "money" && "text-right")}>
                {f.label}
              </th>
            ))}
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row._key} className="border-t align-top">
              <td className="px-1 py-1.5 text-center text-xs text-muted-foreground">
                <div className="flex flex-col items-center">
                  <span className="num">{i + 1}</span>
                  {!disabled && (
                    <span className="flex">
                      <button type="button" className="opacity-40 hover:opacity-100" onClick={() => onChange(moveRow(rows, i, -1))} aria-label="Move up">
                        <ArrowUp className="size-3" />
                      </button>
                      <button type="button" className="opacity-40 hover:opacity-100" onClick={() => onChange(moveRow(rows, i, 1))} aria-label="Move down">
                        <ArrowDown className="size-3" />
                      </button>
                    </span>
                  )}
                </div>
              </td>
              {columns.map((f) => (
                <td key={f.name} className="px-1 py-1.5">
                  {f.readOnly ? (
                    <div className="px-2 py-1 text-right text-xs text-muted-foreground num">
                      {row[f.name] !== null && row[f.name] !== undefined ? formatAmount(toCents(row[f.name] as number)) : "—"}
                    </div>
                  ) : (
                    <FieldInput
                      field={f}
                      value={row[f.name]}
                      onChange={(v) => update(i, f.name, v)}
                      tenant={tenant}
                      labels={{ [f.name]: labels[labelKey(row._key, f)] ?? labels[`${child.name}.${f.name}`] ?? {} }}
                      onLabels={(_, l) => onLabels(labelKey(row._key, f), l)}
                      disabled={disabled}
                      invalid={!!errors?.[`${child.name}.${i}.${f.name}`]}
                      compact
                    />
                  )}
                </td>
              ))}
              <td className="px-1 py-1.5">
                {!disabled && (
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={t("Remove line")}>
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 2} className="px-4 py-6 text-center text-sm text-muted-foreground">
                No {child.label.toLowerCase()} yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-3 py-2">
        {!disabled ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { _key: newKey() }])}>
            <Plus /> {t("Add line")}
          </Button>
        ) : (
          <span />
        )}
        {footer}
      </div>
    </div>
  );
}

export function SummaryLine({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-8 text-sm", strong && "text-base font-semibold", muted && "text-muted-foreground")}>
      <span>{label}</span>
      <span className="num">{formatAmount(value)}</span>
    </div>
  );
}

export const fmtRate = (rate: number) => `${formatDecimal(rate, 2)}%`;
