import { roundCents, toCents, vatFromGross, vatFromNet } from "@/lib/money";

/**
 * Pure document calculation shared by the server (persisted totals, PDFs,
 * bookings) and the browser (live editor preview).
 */

export type PositionType = "item" | "custom" | "text" | "subtotal" | "discount" | "pagebreak";
export type VatMode = "excl" | "incl" | "none";

export interface CalcPosition {
  type: PositionType | string;
  quantity?: number | null;
  /** Unit price in major units. */
  unit_price?: number | null;
  discount_percent?: number | null;
  tax_rate?: number | null;
  tax_id?: number | null;
  is_optional?: boolean | number | null;
}

export interface CalcLine {
  /** Line amount in cents (net for "excl", gross for "incl"); negative for discounts. */
  total: number;
  /** For subtotal positions: running total so far. */
  subtotal?: number;
}

export interface VatBucket {
  rate: number;
  taxId: number | null;
  /** Taxable base (net) in cents. */
  base: number;
  vat: number;
  /** Gross amount (base + vat) in cents. */
  gross: number;
}

export interface CalcResult {
  lines: CalcLine[];
  totalNet: number;
  totalVat: number;
  totalGross: number;
  rounding: number;
  total: number;
  vat: VatBucket[];
}

const isPriced = (t: string) => t === "item" || t === "custom";

export function lineAmount(p: CalcPosition): number {
  const qty = Number(p.quantity ?? 0);
  const price = Number(p.unit_price ?? 0);
  const disc = Number(p.discount_percent ?? 0);
  return toCents(qty * price * (1 - disc / 100));
}

/**
 * @param roundingStep rounding of the final total in major units (0.05 for CHF cash rounding)
 */
export function calculateDocument(positions: CalcPosition[], vatMode: VatMode, roundingStep = 0.01): CalcResult {
  // Buckets keyed by tax id (or rate) holding line amounts (net or gross depending on mode).
  const buckets = new Map<string, { rate: number; taxId: number | null; amount: number }>();
  const lines: CalcLine[] = [];
  let running = 0;

  const bucketKey = (p: CalcPosition) =>
    vatMode === "none" ? "none" : p.tax_id ? `t${p.tax_id}` : `r${Number(p.tax_rate ?? 0)}`;

  for (const p of positions) {
    const type = String(p.type);
    if (isPriced(type)) {
      const amount = lineAmount(p);
      lines.push({ total: amount });
      if (p.is_optional) continue;
      const key = bucketKey(p);
      const bucket = buckets.get(key) ?? {
        rate: vatMode === "none" ? 0 : Number(p.tax_rate ?? 0),
        taxId: vatMode === "none" ? null : (p.tax_id ?? null),
        amount: 0,
      };
      bucket.amount += amount;
      buckets.set(key, bucket);
      running += amount;
    } else if (type === "discount") {
      // Percentage of everything above, or a fixed amount; spread proportionally over VAT buckets.
      const pct = Number(p.discount_percent ?? 0);
      const discount = pct ? Math.round((running * pct) / 100) : toCents(p.unit_price ?? 0);
      const base = running;
      let allocated = 0;
      const entries = [...buckets.values()];
      entries.forEach((b, i) => {
        const share = i === entries.length - 1 ? discount - allocated : base ? Math.round((discount * b.amount) / base) : 0;
        allocated += share;
        b.amount -= share;
      });
      running -= discount;
      lines.push({ total: -discount });
    } else if (type === "subtotal") {
      lines.push({ total: 0, subtotal: running });
    } else {
      lines.push({ total: 0 });
    }
  }

  const vat: VatBucket[] = [];
  for (const b of buckets.values()) {
    if (vatMode === "excl") {
      const v = vatFromNet(b.amount, b.rate);
      vat.push({ rate: b.rate, taxId: b.taxId, base: b.amount, vat: v, gross: b.amount + v });
    } else if (vatMode === "incl") {
      const v = vatFromGross(b.amount, b.rate);
      vat.push({ rate: b.rate, taxId: b.taxId, base: b.amount - v, vat: v, gross: b.amount });
    } else {
      vat.push({ rate: 0, taxId: null, base: b.amount, vat: 0, gross: b.amount });
    }
  }
  vat.sort((a, b) => b.rate - a.rate);

  const totalNet = vat.reduce((s, b) => s + b.base, 0);
  const totalVat = vat.reduce((s, b) => s + b.vat, 0);
  const totalGross = totalNet + totalVat;
  const total = roundCents(totalGross, roundingStep);
  return { lines, totalNet, totalVat, totalGross, rounding: total - totalGross, total, vat };
}

/** Splits a gross bill/expense line into net and VAT according to the VAT mode. */
export function splitAmount(amountCents: number, ratePercent: number, vatMode: "incl" | "excl"): { net: number; vat: number; gross: number } {
  if (vatMode === "excl") {
    const v = vatFromNet(amountCents, ratePercent);
    return { net: amountCents, vat: v, gross: amountCents + v };
  }
  const v = vatFromGross(amountCents, ratePercent);
  return { net: amountCents - v, vat: v, gross: amountCents };
}
