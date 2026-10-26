import type { Ctx } from "./ctx";

export interface SequenceRow {
  key: string;
  format: string;
  next_value: number;
  reset: "never" | "yearly";
  last_year: number | null;
}

export const DEFAULT_SEQUENCES: { key: string; label: string; format: string; reset: "never" | "yearly"; start?: number }[] = [
  { key: "contact", label: "Contacts", format: "{#####}", reset: "never", start: 10001 },
  { key: "item", label: "Products & services", format: "P-{####}", reset: "never" },
  { key: "quote", label: "Quotes", format: "QUO-{YYYY}-{####}", reset: "yearly" },
  { key: "order", label: "Sales orders", format: "ORD-{YYYY}-{####}", reset: "yearly" },
  { key: "delivery", label: "Delivery notes", format: "DEL-{YYYY}-{####}", reset: "yearly" },
  { key: "invoice", label: "Invoices", format: "INV-{YYYY}-{####}", reset: "yearly" },
  { key: "credit_note", label: "Credit notes", format: "CRN-{YYYY}-{####}", reset: "yearly" },
  { key: "purchase_order", label: "Purchase orders", format: "PO-{YYYY}-{####}", reset: "yearly" },
  { key: "bill", label: "Supplier bills", format: "BIL-{YYYY}-{####}", reset: "yearly" },
  { key: "expense", label: "Expenses", format: "EXP-{YYYY}-{####}", reset: "yearly" },
  { key: "journal", label: "Journal entries", format: "{YYYY}-{#####}", reset: "yearly" },
  { key: "project", label: "Projects", format: "PRJ-{####}", reset: "never" },
  { key: "employee", label: "Employees", format: "EMP-{###}", reset: "never" },
];

/** Renders a number format: {YYYY}, {YY}, {MM} and a run of # for the zero-padded counter. */
export function renderNumber(format: string, value: number, date = new Date()): string {
  const year = String(date.getUTCFullYear());
  return format
    .replace(/\{YYYY\}/g, year)
    .replace(/\{YY\}/g, year.slice(2))
    .replace(/\{MM\}/g, String(date.getUTCMonth() + 1).padStart(2, "0"))
    .replace(/\{(#+)\}/g, (_, hashes: string) => String(value).padStart(hashes.length, "0"));
}

/** Reserves the next number of a sequence. */
export async function nextNumber(ctx: Ctx, key: string, date = new Date()): Promise<string> {
  let seq = await ctx.db.first<SequenceRow>("SELECT * FROM sequences WHERE key = ?", key);
  if (!seq) {
    const def = DEFAULT_SEQUENCES.find((s) => s.key === key);
    await ctx.db.run(
      "INSERT OR IGNORE INTO sequences (key, format, next_value, reset, last_year) VALUES (?, ?, ?, ?, ?)",
      key,
      def?.format ?? `${key.toUpperCase()}-{####}`,
      def?.start ?? 1,
      def?.reset ?? "yearly",
      date.getUTCFullYear(),
    );
    seq = (await ctx.db.first<SequenceRow>("SELECT * FROM sequences WHERE key = ?", key))!;
  }
  const year = date.getUTCFullYear();
  if (seq.reset === "yearly" && seq.last_year !== year) {
    await ctx.db.run(
      "UPDATE sequences SET next_value = 1, last_year = ? WHERE key = ? AND (last_year IS NULL OR last_year != ?)",
      year,
      key,
      year,
    );
  }
  const row = await ctx.db.first<{ value: number }>(
    "UPDATE sequences SET next_value = next_value + 1 WHERE key = ? RETURNING next_value - 1 AS value",
    key,
  );
  return renderNumber(seq.format, row!.value, date);
}

export async function previewNumber(ctx: Ctx, key: string): Promise<string> {
  const seq = await ctx.db.first<SequenceRow>("SELECT * FROM sequences WHERE key = ?", key);
  const def = DEFAULT_SEQUENCES.find((s) => s.key === key);
  const year = new Date().getUTCFullYear();
  const value = seq ? (seq.reset === "yearly" && seq.last_year !== year ? 1 : seq.next_value) : (def?.start ?? 1);
  return renderNumber(seq?.format ?? def?.format ?? "{####}", value);
}
