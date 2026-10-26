/**
 * Turns a plain sentence into a structured intent. Pure and deterministic — no
 * AI involved — so it is fast, private and testable. Understands English with
 * a sprinkle of German, French and Italian keywords.
 *
 *   invoice Rhein Logistik 12h development at 160, hosting 49
 *   quote Bergsicht 2x workshop
 *   paid 49.90 for Swisscom internet yesterday
 *   3.5h on Website relaunch: wireframes
 *   Rhein Logistik paid 1636.10
 *   bill from Swisscloud 486.50 due in 20 days
 *   new customer Muster AG, Bahnhofstrasse 1, 8001 Zürich, info@muster.ch
 *   remind me to call Anna on friday
 */

export type QuickIntent = "invoice" | "quote" | "expense" | "time" | "payment" | "contact" | "task" | "bill";

export interface QuickLine {
  quantity: number;
  unit: string | null;
  description: string;
  price: number | null;
}

export interface QuickParse {
  intent: QuickIntent;
  who: string | null;
  amount: number | null;
  date: string | null;
  dueInDays: number | null;
  minutes: number | null;
  lines: QuickLine[];
  text: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  houseNumber: string | null;
  postcode: string | null;
  city: string | null;
}

const empty = (intent: QuickIntent): QuickParse => ({
  intent,
  who: null,
  amount: null,
  date: null,
  dueInDays: null,
  minutes: null,
  lines: [],
  text: null,
  email: null,
  phone: null,
  street: null,
  houseNumber: null,
  postcode: null,
  city: null,
});

// ------------------------------------------------------------------- dates

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, sonntag: 0, dimanche: 0, domenica: 0,
  monday: 1, mon: 1, montag: 1, lundi: 1, lunedi: 1, lunedì: 1,
  tuesday: 2, tue: 2, dienstag: 2, mardi: 2, martedi: 2, martedì: 2,
  wednesday: 3, wed: 3, mittwoch: 3, mercredi: 3, mercoledi: 3, mercoledì: 3,
  thursday: 4, thu: 4, donnerstag: 4, jeudi: 4, giovedi: 4, giovedì: 4,
  friday: 5, fri: 5, freitag: 5, vendredi: 5, venerdi: 5, venerdì: 5,
  saturday: 6, sat: 6, samstag: 6, samedi: 6, sabato: 6,
};

function shift(today: string, days: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Finds a date expression, returning the ISO date and the text without it. */
export function extractDate(input: string, today: string): { date: string | null; rest: string } {
  const rules: [RegExp, (m: RegExpMatchArray) => string | null][] = [
    [/\b(today|heute|aujourd'hui|oggi)\b/i, () => today],
    [/\b(yesterday|gestern|hier|ieri)\b/i, () => shift(today, -1)],
    [/\b(tomorrow|morgen|demain|domani)\b/i, () => shift(today, 1)],
    [/\b(\d{1,2})\s+days?\s+ago\b/i, (m) => shift(today, -Number(m[1]))],
    [/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => `${m[1]}-${m[2]}-${m[3]}`],
    [
      /\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?(?!\d)/,
      (m) => {
        const year = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : today.slice(0, 4);
        return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      },
    ],
    [
      /\b(?:(last|on|next|letzten|am)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i,
      (m) => {
        const target = WEEKDAYS[m[2].toLowerCase()];
        const current = new Date(`${today}T12:00:00Z`).getUTCDay();
        const modifier = (m[1] ?? "").toLowerCase();
        if (modifier === "next") return shift(today, ((target - current + 7) % 7) || 7);
        // "on friday" in the context of past events (time, expenses) means the most recent one.
        const back = (current - target + 7) % 7;
        return shift(today, modifier === "last" || modifier === "letzten" ? -(back || 7) : -back);
      },
    ],
  ];
  for (const [re, fn] of rules) {
    const m = input.match(re);
    if (m) {
      const date = fn(m);
      if (date && !Number.isNaN(Date.parse(date))) {
        return { date, rest: (input.slice(0, m.index) + input.slice((m.index ?? 0) + m[0].length)).replace(/\s{2,}/g, " ").trim() };
      }
    }
  }
  return { date: null, rest: input };
}

// ----------------------------------------------------------------- numbers

const NUMBER = String.raw`\d{1,3}(?:['’]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;

export function toNumber(raw: string): number {
  return Number(raw.replace(/['’\s]/g, "").replace(/[.,]–$|\.-$/, "").replace(",", "."));
}

/** First money amount in the text ("CHF 1'234.50", "49.90", "12.–", "€20"). */
export function extractAmount(input: string): { amount: number | null; rest: string } {
  const re = new RegExp(String.raw`(?:(?:chf|fr\.?|sfr\.?|€|eur)\s*)?(${NUMBER})(?:\s*(?:\.[-–]|chf|fr\.?|francs?|franken|€|eur))?(?![\d.]*\s*(?:h|hrs?|hours?|std|min|minutes?|x|pcs|stk|days?)\b)`, "i");
  const m = input.match(re);
  if (!m) return { amount: null, rest: input };
  const amount = toNumber(m[1]);
  return Number.isFinite(amount) ? { amount, rest: (input.slice(0, m.index) + input.slice((m.index ?? 0) + m[0].length)).replace(/\s{2,}/g, " ").trim() } : { amount: null, rest: input };
}

/** "3.5h", "2h 30m", "2h30", "1:45", "90 min", "1,5 std" → minutes. */
export function extractDuration(input: string): { minutes: number | null; rest: string } {
  const re = /\b(\d+(?:[.,]\d+)?)\s*(?:h|hrs?|hours?|std|stunden?)(?:(\d{2})\b|\s*(\d{1,2})\s*(?:m|min|minutes?)\b|\b)|\b(\d{1,2}):(\d{2})\s*h?\b|\b(\d+)\s*(?:m|min|mins|minutes?)\b/i;
  const m = input.match(re);
  if (!m) return { minutes: null, rest: input };
  const minutes = m[1]
    ? Math.round(toNumber(m[1]) * 60 + Number(m[2] ?? m[3] ?? 0))
    : m[4]
      ? Number(m[4]) * 60 + Number(m[5])
      : Number(m[6]);
  return { minutes, rest: (input.slice(0, m.index) + input.slice((m.index ?? 0) + m[0].length)).replace(/\s{2,}/g, " ").trim() };
}

// ------------------------------------------------------------------ lines

/** "12h development at 160", "2x workshop", "hosting 49", "consulting 4h @180" */
export function parseLine(segment: string): QuickLine | null {
  let s = segment.trim().replace(/^(and|und|et|e)\s+/i, "");
  if (!s) return null;
  let price: number | null = null;
  const at = s.match(new RegExp(String.raw`\s*(?:@|at|à|a|zu|à)\s*(?:chf\s*)?(${NUMBER})\s*(?:chf|fr\.?)?\s*(?:/\s*(?:h|hour|std|pcs|stk))?\s*$`, "i"));
  if (at) {
    price = toNumber(at[1]);
    s = s.slice(0, at.index).trim();
  }
  let quantity = 1;
  let unit: string | null = null;
  const lead = s.match(/^(\d+(?:[.,]\d+)?)\s*(h|hrs?|hours?|std|x|×|pcs|stk|days?|tage?)?\s+(.+)$/i);
  const trail = s.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s*(h|hrs?|hours?|std|x|×|pcs|stk|days?|tage?)\s*$/i);
  if (lead) {
    quantity = toNumber(lead[1]);
    unit = normalizeUnit(lead[2]);
    s = lead[3];
  } else if (trail) {
    quantity = toNumber(trail[2]);
    unit = normalizeUnit(trail[3]);
    s = trail[1];
  } else if (price === null) {
    // "hosting 49" — a trailing number without unit is a price.
    const trailingPrice = s.match(new RegExp(String.raw`^(.+?)\s+(?:chf\s*)?(${NUMBER})\s*(?:chf|fr\.?)?$`, "i"));
    if (trailingPrice) {
      price = toNumber(trailingPrice[2]);
      s = trailingPrice[1];
    }
  }
  const description = s.replace(/^(of|von|de|di)\s+/i, "").trim();
  if (!description) return null;
  return { quantity: Number.isFinite(quantity) ? quantity : 1, unit, description, price };
}

function normalizeUnit(u: string | undefined): string | null {
  if (!u) return null;
  const v = u.toLowerCase();
  if (/^(h|hrs?|hours?|std)$/.test(v)) return "h";
  if (/^(days?|tage?)$/.test(v)) return "day";
  if (/^(pcs|stk)$/.test(v)) return "pcs";
  return null;
}

function splitLines(text: string): QuickLine[] {
  return text
    .split(/\s*(?:,|;|\+|\band\b|\bund\b|\bet\b)\s*/i)
    .map(parseLine)
    .filter((l): l is QuickLine => !!l);
}

// ------------------------------------------------------------------ intents

const INVOICE = /^(?:invoice|bill to|rechnung an|rechnung|facture|fattura)\s+/i;
const QUOTE = /^(?:quote|offer|offerte|angebot|devis|offerta)\s+/i;
const EXPENSE = /^(?:paid|spent|bought|expense|receipt|bezahlt|ausgegeben|payé|pagato)\b\s*/i;
const BILL = /^(?:bill from|invoice from|rechnung von|facture de|fattura da)\s+/i;
const CONTACT = /^(?:new\s+|neuer?\s+|nouveau\s+)?(customer|client|contact|supplier|vendor|kunde|lieferant|kontakt|fournisseur|cliente|fornitore)\s+/i;
const TASK = /^(?:remind me to|reminder:?|todo:?|to-do:?|task:?|erinnere mich(?: an)?|rappelle-moi de)\s+/i;
const PAYMENT = /^(.+?)\s+(?:paid|has paid|transferred|hat bezahlt|a payé|ha pagato)(?:\s+(?:me|us|uns))?\b\s*(.*)$/i;
const TIME_LEAD = /^(?:worked|logged|log|tracked|track|gearbeitet)\s+/i;

function splitWhoAndLines(rest: string): { who: string | null; lines: QuickLine[] } {
  // "<who>: <lines>" or "<who>, <lines>"
  const colon = rest.match(/^([^:]+):\s*(.+)$/);
  if (colon) return { who: colon[1].trim(), lines: splitLines(colon[2]) };
  // "<lines> for <who>"
  const forWho = rest.match(/^(\d.+?)\s+(?:for|für|pour|per)\s+(.+)$/i);
  if (forWho) return { who: forWho[2].trim(), lines: splitLines(forWho[1]) };
  // "<who> <qty…>" — the customer is everything before the first number.
  const firstNumber = rest.search(/\s\d/);
  if (firstNumber > 0) return { who: rest.slice(0, firstNumber).replace(/[,–-]\s*$/, "").trim(), lines: splitLines(rest.slice(firstNumber + 1)) };
  // "<who>, <description>" without numbers
  const comma = rest.match(/^([^,]+),\s*(.+)$/);
  if (comma) return { who: comma[1].trim(), lines: splitLines(comma[2]) };
  return { who: rest.trim() || null, lines: [] };
}

export function parseQuick(raw: string, today: string): QuickParse | null {
  const input = raw.replace(/\s+/g, " ").trim();
  if (input.length < 3) return null;

  if (INVOICE.test(input) || QUOTE.test(input)) {
    const intent: QuickIntent = INVOICE.test(input) ? "invoice" : "quote";
    const { date, rest } = extractDate(input.replace(intent === "invoice" ? INVOICE : QUOTE, ""), today);
    const { who, lines } = splitWhoAndLines(rest);
    return { ...empty(intent), who, lines, date };
  }

  if (BILL.test(input)) {
    let rest = input.replace(BILL, "");
    let dueInDays: number | null = null;
    const due = rest.match(/\b(?:due in|payable in|zahlbar in|fällig in)\s+(\d{1,3})\s*(?:days?|tagen?|jours?)\b/i);
    if (due) {
      dueInDays = Number(due[1]);
      rest = rest.replace(due[0], " ");
    }
    const d = extractDate(rest, today);
    const a = extractAmount(d.rest);
    const [who, ...textParts] = a.rest.split(/\s*(?:,|:|\bfor\b|\bfür\b|\bpour\b)\s*/i);
    return { ...empty("bill"), who: who?.trim() || null, amount: a.amount, date: d.date, dueInDays, text: textParts.join(" ").trim() || null };
  }

  if (EXPENSE.test(input)) {
    const d = extractDate(input.replace(EXPENSE, ""), today);
    const a = extractAmount(d.rest);
    const text = a.rest.replace(/^(?:for|on|at|für|pour|per|bei|chez)\s+/i, "").replace(/\s+(?:for|on|at)\s*$/i, "").trim();
    return { ...empty("expense"), amount: a.amount, date: d.date, text: text || null };
  }

  if (CONTACT.test(input)) {
    const kind = input.match(CONTACT)![1].toLowerCase();
    const rest = input.replace(CONTACT, "");
    const parts = rest.split(/\s*,\s*/);
    const out = { ...empty("contact"), who: parts[0]?.trim() || null };
    out.text = /supplier|vendor|lieferant|fournisseur|fornitore/.test(kind) ? "supplier" : "customer";
    for (const p of parts.slice(1)) {
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p)) out.email = p;
      else if (/^\+?[\d\s()/-]{7,}$/.test(p)) out.phone = p;
      else if (/^(?:CH-)?\d{4}\s+\S/.test(p)) {
        const m = p.match(/^(?:CH-)?(\d{4})\s+(.+)$/)!;
        out.postcode = m[1];
        out.city = m[2];
      } else if (/\d/.test(p) && !out.street) {
        const m = p.match(/^(.*?)\s*(\d+\w?)$/);
        out.street = m ? m[1] : p;
        out.houseNumber = m ? m[2] : null;
      }
    }
    return out;
  }

  if (TASK.test(input)) {
    const d = extractDate(input.replace(TASK, ""), today);
    return { ...empty("task"), text: d.rest.replace(/\s+(?:on|am|le)\s*$/i, "").trim() || null, date: d.date };
  }

  const dur = extractDuration(input.replace(TIME_LEAD, ""));
  if (dur.minutes) {
    const d = extractDate(dur.rest, today);
    const m = d.rest.match(/^(?:of\s+\w+\s+)?(?:on|for|für|bei|sur|pour|per|@)\s+([^:,]+?)(?:\s*[:,–-]\s*(.+))?$/i);
    return {
      ...empty("time"),
      minutes: dur.minutes,
      date: d.date,
      who: m ? m[1].trim() : null,
      text: m ? (m[2]?.trim() ?? null) : d.rest || null,
    };
  }

  const pay = input.match(PAYMENT);
  if (pay) {
    const d = extractDate(pay[2] ?? "", today);
    const a = extractAmount(d.rest);
    return { ...empty("payment"), who: pay[1].trim(), amount: a.amount, date: d.date };
  }

  return null;
}
