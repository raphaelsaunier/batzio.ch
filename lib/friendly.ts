import type { FieldDef, FieldOption, ResourceDef } from "@/lib/resources/types";

/**
 * Batzio speaks human. In "simple" mode the UI swaps accounting jargon for
 * plain words; "accountant" mode shows the classic terms and the full ledger.
 * The API and MCP always use the canonical names.
 */
export type UiMode = "simple" | "accountant";
export const MODE_COOKIE = "batzio_mode";

type Mood = "happy" | "wink" | "sleepy" | "party" | "worried" | "cool" | "wave" | "thinking";

interface FriendlyCopy {
  label?: string;
  labelPlural?: string;
  description?: string;
  empty?: { title: string; text: string; mood?: Mood };
}

export const FRIENDLY: Record<string, FriendlyCopy> = {
  invoices: {
    description: "Bills you send. We add the QR code, book them and chase late payers for you.",
    empty: { title: "No invoices yet", text: "Type “invoice Muster AG 3h consulting” on the Today page and you’re done.", mood: "wave" },
  },
  quotes: {
    description: "Offers that turn into orders or invoices with one click.",
    empty: { title: "No quotes yet", text: "Make an offer they can’t refuse.", mood: "wink" },
  },
  orders: { labelPlural: "Orders", description: "Confirmed work. Can repeat itself every month if you like." },
  deliveries: { description: "Paperwork that travels with the goods." },
  credit_notes: { description: "When you owe a customer money back." },
  reminders: {
    label: "Nudge",
    labelPlural: "Nudges",
    description: "Friendly (then slightly less friendly) reminders for late payers.",
    empty: { title: "Nobody to nudge", text: "Everyone pays on time. Suspicious, but nice.", mood: "cool" },
  },
  payments: { label: "Money received", labelPlural: "Money received", description: "Every franc that landed on an invoice." },
  bills: {
    label: "Bill to pay",
    labelPlural: "Bills to pay",
    description: "Invoices you receive. Check, book, pay — in that order, mostly with one click.",
    empty: { title: "No bills. Zero. Nada.", text: "Enjoy it while it lasts.", mood: "cool" },
  },
  expenses: {
    label: "Receipt",
    labelPlural: "Receipts",
    description: "Things you paid on the go — train tickets, coffee with clients, that one cable.",
    empty: { title: "No receipts", text: "Paid for something? Just type “paid 12.50 for coffee”.", mood: "happy" },
  },
  outgoing_payments: { label: "Payment out", labelPlural: "Payments out", description: "Money queued to leave the account. Export once, pay all." },
  purchase_orders: { description: "Things you ordered from suppliers." },
  bank_transactions: {
    label: "Bank line",
    labelPlural: "Bank inbox",
    description: "Every line from your bank statement. We match what we can; you confirm with a click.",
    empty: { title: "Bank inbox is empty", text: "Import a statement and watch the matching magic.", mood: "sleepy" },
  },
  bank_accounts: { description: "Where your money lives." },
  contacts: {
    label: "Contact",
    labelPlural: "People & companies",
    description: "Customers, suppliers and everyone in between.",
    empty: { title: "It’s quiet in here", text: "Add your first customer — or type “new customer Muster AG”.", mood: "wave" },
  },
  notes: { description: "Little things worth remembering." },
  projects: { description: "Work with a beginning, an end and (ideally) a budget." },
  timesheets: {
    label: "Time entry",
    labelPlural: "Time",
    description: "Hours you worked. Billable ones become invoices with one click.",
    empty: { title: "No time tracked", text: "Type “2h on Website relaunch” and it’s logged.", mood: "sleepy" },
  },
  tasks: { label: "To-do", labelPlural: "To-dos", description: "Things to do. Batzi won’t judge." },
  business_activities: { description: "Kinds of work and what they cost per hour." },
  employees: { label: "Team member", labelPlural: "Team", description: "The humans. Salaries, insurances, the lot." },
  payslips: { label: "Salary", labelPlural: "Salaries", description: "Monthly payslips with all the Swiss deductions done for you." },
  absences: { label: "Time off", labelPlural: "Time off", description: "Holidays, sick days and everything in between." },
  items: { description: "What you sell, with prices you don’t have to remember." },
  journal_entries: { description: "The ledger. Mostly written by Batzio, occasionally by you." },
  files: { description: "Receipts, scans and attachments." },
};

/** Plain-language status labels (simple mode). Tones are kept from the definition. */
export const STATUS: Record<string, Record<string, string>> = {
  invoices: { draft: "Draft", open: "Waiting for money", partial: "Partly paid", paid: "Paid", written_off: "Written off", cancelled: "Cancelled" },
  quotes: { draft: "Draft", open: "Waiting for a yes", accepted: "Accepted", rejected: "Declined", cancelled: "Cancelled" },
  orders: { draft: "Draft", open: "In progress", done: "Done", cancelled: "Cancelled" },
  credit_notes: { draft: "Draft", open: "To refund", partial: "Partly refunded", settled: "Refunded", cancelled: "Cancelled" },
  bills: { draft: "To check", booked: "To pay", partial: "Partly paid", paid: "Paid", cancelled: "Cancelled" },
  expenses: { draft: "To book", booked: "Booked" },
  outgoing_payments: { open: "Queued", exported: "Sent to bank", paid: "Paid", cancelled: "Cancelled" },
  bank_transactions: { unmatched: "Needs a look", suggested: "Match found", booked: "Done", ignored: "Ignored" },
  payslips: { draft: "Draft", final: "Paid out" },
};

export function friendlyResource(res: ResourceDef, mode: UiMode) {
  const copy = mode === "simple" ? FRIENDLY[res.name] : undefined;
  return {
    label: copy?.label ?? res.label,
    labelPlural: copy?.labelPlural ?? res.labelPlural,
    description: copy?.description ?? res.description,
    empty: FRIENDLY[res.name]?.empty,
  };
}

function friendlyOptions(resource: string, options: FieldOption[] | undefined): FieldOption[] | undefined {
  const map = STATUS[resource];
  if (!map || !options) return options;
  return options.map((o) => ({ ...o, label: map[o.value] ?? o.label }));
}

/** Fields with friendly status labels applied (simple mode only). */
export function friendlyFields(res: ResourceDef, mode: UiMode): FieldDef[] {
  if (mode !== "simple" || !res.statusField) return res.fields;
  return res.fields.map((f) => (f.name === res.statusField ? { ...f, options: friendlyOptions(res.name, f.options) } : f));
}

/** Groups of related screens, shown as tabs so the sidebar can stay tiny. */
export interface Family {
  id: string;
  title: string;
  icon: string;
  members: string[];
  extras?: { title: string; path: string }[];
  accountantOnly?: boolean;
}

export const FAMILIES: Family[] = [
  { id: "get-paid", title: "Get paid", icon: "HandCoins", members: ["invoices", "quotes", "orders", "deliveries", "credit_notes", "reminders", "payments"] },
  { id: "pay", title: "Pay", icon: "Wallet", members: ["bills", "expenses", "outgoing_payments", "purchase_orders"] },
  { id: "bank", title: "Bank", icon: "Landmark", members: ["bank_transactions", "bank_accounts"], extras: [{ title: "Import & export", path: "/banking/import" }] },
  { id: "people", title: "People", icon: "Users", members: ["contacts", "notes"] },
  { id: "work", title: "Work", icon: "FolderKanban", members: ["projects", "timesheets", "tasks", "business_activities"] },
  { id: "team", title: "Team", icon: "IdCard", members: ["employees", "payslips", "absences"], extras: [{ title: "Payroll run", path: "/payroll" }] },
  { id: "products", title: "Products", icon: "Package", members: ["items", "stock_movements", "stock_locations"] },
  { id: "books", title: "Books", icon: "BookOpen", members: ["journal_entries", "accounts", "taxes", "vat_periods", "business_years", "currencies"], accountantOnly: true },
];

export function familyOf(resource: string): Family | undefined {
  return FAMILIES.find((f) => f.members.includes(resource));
}

const GREETINGS = [
  { lang: "de", morning: "Guete Morge", day: "Grüezi", evening: "Guete Abig" },
  { lang: "fr", morning: "Bonjour", day: "Salut", evening: "Bonsoir" },
  { lang: "it", morning: "Buongiorno", day: "Ciao", evening: "Buonasera" },
  { lang: "rm", morning: "Bun di", day: "Allegra", evening: "Buna saira" },
];

/** A Swiss greeting that changes with the hour and the day. */
export function greeting(date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Europe/Zurich" }).format(date));
  const g = GREETINGS[date.getUTCDate() % GREETINGS.length];
  return hour < 11 ? g.morning : hour < 18 ? g.day : g.evening;
}
