/**
 * Money helpers. Amounts are stored as integer minor units (Rappen/cents) to
 * avoid floating point drift; APIs and forms use decimal major units.
 */

/** Converts a decimal amount (e.g. 12.35 or "12.35") to integer cents. */
export function toCents(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(String(value).replace(/['’\s]/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  // Round half away from zero, compensating for binary representation (1.005 → 101).
  const scaled = n * 100;
  return Math.sign(scaled) * Math.round(Math.abs(scaled) + 1e-8);
}

export function fromCents(cents: number | null | undefined): number {
  if (cents === null || cents === undefined) return 0;
  return Math.round(cents) / 100;
}

/** Rounds cents to a rounding step expressed in major units (0.05 = 5 Rappen). */
export function roundCents(cents: number, step = 0.01): number {
  const unit = Math.max(1, Math.round(step * 100));
  return Math.sign(cents) * Math.round(Math.abs(cents) / unit) * unit;
}

/** Rounds a decimal to `digits` places, half away from zero. */
export function roundTo(value: number, digits = 2): number {
  const f = 10 ** digits;
  return (Math.sign(value) * Math.round(Math.abs(value) * f + 1e-8)) / f;
}

/** VAT contained in a gross amount: gross × rate / (100 + rate). */
export function vatFromGross(grossCents: number, ratePercent: number): number {
  if (!ratePercent) return 0;
  return Math.round((grossCents * ratePercent) / (100 + ratePercent));
}

/** VAT on top of a net amount. */
export function vatFromNet(netCents: number, ratePercent: number): number {
  if (!ratePercent) return 0;
  return Math.round((netCents * ratePercent) / 100);
}

export function sumCents(values: number[]): number {
  return values.reduce((a, b) => a + Math.round(b), 0);
}
