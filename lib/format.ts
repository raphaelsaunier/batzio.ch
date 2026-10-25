import { fromCents } from "./money";

export const LOCALE = "de-CH";

const moneyFormatters = new Map<string, Intl.NumberFormat>();

function moneyFormatter(digits: number): Intl.NumberFormat {
  const key = String(digits);
  let f = moneyFormatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    moneyFormatters.set(key, f);
  }
  return f;
}

/** 123456 → "1’234.56" */
export function formatAmount(cents: number | null | undefined, digits = 2): string {
  return moneyFormatter(digits).format(fromCents(cents ?? 0));
}

/** 123456 → "CHF 1’234.56" */
export function formatMoney(cents: number | null | undefined, currency = "CHF"): string {
  return `${currency} ${formatAmount(cents)}`;
}

/** Formats a decimal major-unit number with Swiss separators. */
export function formatDecimal(value: number | null | undefined, maxDigits = 2, minDigits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: minDigits, maximumFractionDigits: maxDigits }).format(
    value,
  );
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return `${formatDecimal(value, 2)}%`;
}

/** "2026-10-25" → "25.10.2026" */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Zurich",
  }).format(d);
}

/** Minutes → "7:30" */
export function formatDuration(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(minutes ?? 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

/** Today's date in Zurich as YYYY-MM-DD. */
export function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}
