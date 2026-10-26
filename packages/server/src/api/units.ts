/**
 * Reports are computed in minor units (cents). Before leaving the API they are
 * converted to major units so every amount in the API follows one convention.
 */
const MONEY_KEYS = new Set([
  "amount", "total", "opening", "debit", "credit", "balance", "closing", "base", "tax", "taxDue", "inputTax", "payable",
  "revenueYtd", "expensesYtd", "profitYtd", "cash", "open", "overdue", "dueSoon", "value", "revenue", "expenses",
  "amount_open", "receipts", "payments", "gross", "social", "bvg", "insurance", "withholding_tax", "allowances", "net",
  "employer_cost",
]);
/** Objects whose numeric values are all amounts. */
const MONEY_MAPS = new Set(["digits", "buckets"]);

export function toMajorUnits(value: unknown, key?: string, inMoneyMap = false): unknown {
  if (typeof value === "number") return inMoneyMap || (key && MONEY_KEYS.has(key)) ? Math.round(value) / 100 : value;
  if (Array.isArray(value)) return value.map((v) => toMajorUnits(v, key, false));
  if (value && typeof value === "object" && !(value instanceof Response)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = toMajorUnits(v, k, MONEY_MAPS.has(k));
    return out;
  }
  return value;
}
