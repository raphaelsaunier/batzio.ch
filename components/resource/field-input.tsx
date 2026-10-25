"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { FieldDef } from "@/lib/resources/types";
import { cn } from "@/lib/utils";
import { RefSelect, TagsSelect } from "./ref-select";
import { useT } from "@/lib/i18n/client";

export type FormValues = Record<string, unknown>;
export type FormLabels = Record<string, Record<string, string>>;

const NONE = "__none";

/** Renders an editable control for a field, working with API-shaped values. */
export function FieldInput({
  field,
  value,
  onChange,
  tenant,
  labels,
  onLabels,
  disabled,
  invalid,
  compact,
  id,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  tenant: string;
  labels?: FormLabels;
  onLabels?: (field: string, labels: Record<string, string>) => void;
  disabled?: boolean;
  invalid?: boolean;
  compact?: boolean;
  id?: string;
}) {
  const t = useT();
  const size = compact ? "h-7 text-xs" : undefined;
  const str = value === null || value === undefined ? "" : String(value);

  switch (field.type) {
    case "text":
      return (
        <Textarea
          id={id}
          value={str}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={invalid}
          placeholder={field.placeholder}
          rows={compact ? 1 : 3}
          className={cn("bg-background", compact && "min-h-7 resize-y py-1 text-xs")}
        />
      );
    case "json":
      return (
        <Textarea
          id={id}
          value={typeof value === "string" ? value : value ? JSON.stringify(value, null, 2) : ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={invalid}
          rows={3}
          className="bg-background font-mono text-xs"
          placeholder={field.description}
        />
      );
    case "boolean":
      return (
        <div className={cn("flex items-center", compact ? "h-7" : "h-8")}>
          <Switch id={id} checked={!!value && value !== "false" && value !== 0} onCheckedChange={(v) => onChange(v)} disabled={disabled} />
        </div>
      );
    case "enum":
      return (
        <Select value={str || NONE} onValueChange={(v) => onChange(v === NONE ? null : v)} disabled={disabled}>
          <SelectTrigger id={id} className={cn("w-full bg-background", size)} aria-invalid={invalid} size={compact ? "sm" : "default"}>
            <SelectValue placeholder={t("Select…")} />
          </SelectTrigger>
          <SelectContent>
            {!field.required && <SelectItem value={NONE}>—</SelectItem>}
            {(field.options ?? []).map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "ref":
      return (
        <RefSelect
          tenant={tenant}
          resource={field.ref!}
          value={value === null || value === undefined || value === "" ? null : Number(value)}
          label={labels?.[field.name]?.[str]}
          filter={field.refFilter}
          disabled={disabled}
          invalid={invalid}
          compact={compact}
          onChange={(nextId, nextLabel) => {
            if (nextId && nextLabel) onLabels?.(field.name, { ...(labels?.[field.name] ?? {}), [nextId]: nextLabel });
            onChange(nextId);
          }}
        />
      );
    case "tags": {
      let ids: number[] = [];
      if (Array.isArray(value)) ids = value.map(Number);
      else if (typeof value === "string" && value) {
        try {
          ids = JSON.parse(value);
        } catch {
          ids = [];
        }
      }
      return (
        <TagsSelect
          tenant={tenant}
          resource={field.ref!}
          value={ids}
          labels={labels?.[field.name] ?? {}}
          disabled={disabled}
          onChange={(next, nextLabels) => {
            onLabels?.(field.name, nextLabels);
            onChange(next);
          }}
        />
      );
    }
    case "date":
      return <Input id={id} type="date" value={str.slice(0, 10)} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} aria-invalid={invalid} className={cn("bg-background", size)} />;
    case "time":
      return <Input id={id} type="time" value={str} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} aria-invalid={invalid} className={cn("bg-background", size)} />;
    case "datetime":
      return <Input id={id} value={str ? new Date(str).toLocaleString("de-CH") : ""} disabled className={cn("bg-muted/40", size)} />;
    case "color":
      return (
        <div className="flex gap-2">
          <Input type="color" value={str || "#2f5f8f"} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-8 w-12 p-1" />
          <Input id={id} value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="bg-background font-mono" />
        </div>
      );
    case "int":
    case "decimal":
    case "money":
    case "percent":
      return (
        <Input
          id={id}
          inputMode="decimal"
          value={str}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={invalid}
          placeholder={field.placeholder ?? (field.type === "money" ? "0.00" : undefined)}
          className={cn("bg-background text-right num", size)}
        />
      );
    default:
      return (
        <Input
          id={id}
          type={field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "phone" ? "tel" : "text"}
          value={str}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-invalid={invalid}
          placeholder={field.placeholder}
          maxLength={field.maxLength}
          className={cn("bg-background", field.type === "iban" && "font-mono", field.format === "code" && "font-mono", size)}
        />
      );
  }
}
