import { Check, Minus } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatAmount, formatDate, formatDateTime, formatDecimal, formatDuration } from "@batzio/core/format";
import { optionFor, type Labels } from "@batzio/server/resources/client";
import { TONE_CLASSES } from "@/lib/tones";
import type { FieldDef } from "@batzio/server/resources/types";
import { formatIban } from "@batzio/core/swiss/iban";
import { cn } from "@/lib/utils";

export function isNumericField(field: FieldDef) {
  return ["money", "decimal", "int", "percent"].includes(field.type) && field.format !== "code";
}

export function StatusBadge({ field, value, className }: { field?: FieldDef; value: unknown; className?: string }) {
  const option = optionFor(field, value);
  if (!option) return value ? <Badge variant="outline">{String(value)}</Badge> : null;
  return (
    <Badge variant="outline" className={cn("font-medium", TONE_CLASSES[option.tone ?? "neutral"], className)}>
      {option.label}
    </Badge>
  );
}

/** Renders a DB-shaped value for display. */
export function CellValue({
  field,
  value,
  labels,
  tenant,
}: {
  field: FieldDef;
  value: unknown;
  labels?: Labels;
  tenant?: string;
}) {
  if (value === null || value === undefined || value === "") return <span className="text-muted-foreground/50">—</span>;
  switch (field.type) {
    case "money":
      return <span className="num">{formatAmount(Number(value))}</span>;
    case "decimal":
      return <span className="num">{formatDecimal(Number(value), 4)}</span>;
    case "percent":
      return <span className="num">{formatDecimal(Number(value), 2)}%</span>;
    case "int":
      return field.format === "duration" ? <span className="num">{formatDuration(Number(value))}</span> : <span className="num">{String(value)}</span>;
    case "date":
      return <span className="num whitespace-nowrap">{formatDate(String(value))}</span>;
    case "datetime":
      return <span className="num whitespace-nowrap">{formatDateTime(String(value))}</span>;
    case "boolean":
      return Number(value) ? <Check className="size-4 text-success" /> : <Minus className="size-4 text-muted-foreground/40" />;
    case "enum":
      return <StatusBadge field={field} value={value} />;
    case "iban":
      return <span className="font-mono text-xs whitespace-nowrap">{formatIban(String(value))}</span>;
    case "color":
      return (
        <span className="inline-flex items-center gap-2">
          <span className="size-3 rounded-full border" style={{ background: String(value) }} />
          <span className="font-mono text-xs">{String(value)}</span>
        </span>
      );
    case "ref": {
      const label = labels?.[field.name]?.[String(value)] ?? `#${value}`;
      return tenant && field.ref ? (
        <Link href={`/${tenant}/${field.ref}/${value}`} className="relative z-10 hover:text-primary hover:underline">
          {label}
        </Link>
      ) : (
        <span>{label}</span>
      );
    }
    case "tags": {
      let ids: unknown[] = [];
      try {
        ids = typeof value === "string" ? JSON.parse(value) : (value as unknown[]);
      } catch {
        ids = [];
      }
      return (
        <span className="flex flex-wrap gap-1">
          {ids.map((id) => (
            <Badge key={String(id)} variant="secondary" className="font-normal">
              {labels?.[field.name]?.[String(id)] ?? `#${id}`}
            </Badge>
          ))}
        </span>
      );
    }
    case "json":
      return <span className="font-mono text-xs text-muted-foreground">{typeof value === "string" ? value.slice(0, 60) : JSON.stringify(value).slice(0, 60)}</span>;
    case "text":
      return <span className="line-clamp-2 whitespace-pre-line">{String(value)}</span>;
    default:
      if (field.format === "code") return <span className="font-mono text-xs whitespace-nowrap">{String(value)}</span>;
      if (field.format === "strong") return <span className="font-medium text-foreground">{String(value)}</span>;
      return <span>{String(value)}</span>;
  }
}
