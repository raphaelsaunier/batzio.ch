import { calculateDocument } from "@/lib/calc/documents";
import { addDays, formatAmount, formatDate, formatDuration, today } from "@/lib/format";
import { toCents } from "@/lib/money";
import { bestMatch, categorize, similarity } from "@/lib/quick/autopilot";
import { parseQuick, type QuickIntent, type QuickParse } from "@/lib/quick/parse";
import { getResource } from "@/lib/resources/registry";
import { accountIdByNumber } from "@/lib/server/accounting";
import { createRecord, getRecord, runAction } from "@/lib/server/crud";
import type { Ctx } from "@/lib/server/ctx";
import { AppError } from "@/lib/server/errors";
import { bookExpense } from "@/lib/server/purchases";
import { msg, type Msg } from "@/lib/i18n";
import type { RecordRef } from "./importers";


export interface QuickPlan {
  intent: QuickIntent;
  headline: Msg;
  details: Msg[];
  warnings: Msg[];
  actions: { id: string; label: Msg; primary?: boolean }[];
  /** Gross total in cents, when meaningful. */
  total?: number;
}

export interface QuickOutcome {
  message: Msg;
  record?: RecordRef;
  celebrate?: boolean;
}

const contactName = (c: { type: string; name_1: string; name_2: string | null }) =>
  c.type === "person" ? `${c.name_2 ?? ""} ${c.name_1}`.trim() : c.name_1;

interface Resolved {
  parse: QuickParse;
  contact?: { id: number; name: string } | null;
  project?: { id: number; name: string; contact_id: number | null } | null;
  positions?: { item_id: number | null; text: string; quantity: number; unit_name: string | null; unit_price: number; tax_id: number | null; tax_rate: number }[];
  invoice?: { id: number; nr: string | null; amount_open: number } | null;
  activity?: { id: number; name: string } | null;
}

async function contacts(ctx: Ctx, filter = "") {
  return ctx.db.all<{ id: number; type: string; name_1: string; name_2: string | null; is_supplier: number }>(
    `SELECT id, type, name_1, name_2, is_supplier FROM contacts WHERE archived_at IS NULL ${filter}`,
  );
}

async function resolve(ctx: Ctx, parse: QuickParse): Promise<Resolved> {
  const out: Resolved = { parse };
  if (["invoice", "quote", "payment", "bill", "contact"].includes(parse.intent) && parse.who) {
    const list = await contacts(ctx);
    const match = bestMatch(parse.who, list, contactName, parse.intent === "contact" ? 0.9 : 0.5);
    out.contact = match ? { id: match.id, name: contactName(match) } : null;
  }
  if (parse.intent === "invoice" || parse.intent === "quote") {
    const items = await ctx.db.all<{ id: number; name: string; sale_price: number | null; sales_tax_id: number | null; unit: string | null }>(
      "SELECT items.id, items.name, items.sale_price, items.sales_tax_id, units.name AS unit FROM items LEFT JOIN units ON units.id = items.unit_id WHERE archived_at IS NULL",
    );
    const activities = await ctx.db.all<{ id: number; name: string; hourly_rate: number | null }>("SELECT id, name, hourly_rate FROM business_activities");
    const taxes = await ctx.db.all<{ id: number; code: string; rate: number }>("SELECT id, code, rate FROM taxes WHERE type = 'sales'");
    const fallbackTax = taxes.find((t) => t.code === "UN81");
    out.positions = parse.lines.map((line) => {
      const item = bestMatch(line.description, items, (i) => i.name, 0.6);
      const activity = line.unit === "h" ? bestMatch(line.description, activities, (a) => a.name, 0.6) : null;
      const tax = item?.sales_tax_id ? taxes.find((t) => t.id === item.sales_tax_id) : fallbackTax;
      return {
        item_id: item?.id ?? null,
        text: item && similarity(line.description, item.name) > 0.9 ? item.name : line.description.charAt(0).toUpperCase() + line.description.slice(1),
        quantity: line.quantity,
        unit_name: line.unit === "h" ? (item?.unit ?? "h") : (item?.unit ?? null),
        unit_price: line.price ?? item?.sale_price ?? activity?.hourly_rate ?? 0,
        tax_id: tax?.id ?? null,
        tax_rate: tax?.rate ?? 0,
      };
    });
  }
  if (parse.intent === "time") {
    const projects = await ctx.db.all<{ id: number; name: string; contact_id: number | null }>(
      "SELECT id, name, contact_id FROM projects WHERE archived_at IS NULL AND status IN ('active','planned','on_hold')",
    );
    let project = parse.who ? bestMatch(parse.who, projects, (p) => p.name, 0.5) : null;
    if (!project && parse.who) {
      const c = bestMatch(parse.who, await contacts(ctx), contactName, 0.5);
      if (c) project = projects.find((p) => p.contact_id === c.id) ?? null;
    }
    out.project = project;
    const activities = await ctx.db.all<{ id: number; name: string }>("SELECT id, name FROM business_activities");
    out.activity = parse.text ? (activities.find((a) => (parse.text ?? "").toLowerCase().includes(a.name.toLowerCase())) ?? null) : null;
  }
  if (parse.intent === "payment" && out.contact) {
    const open = await ctx.db.all<{ id: number; nr: string | null; amount_open: number }>(
      "SELECT id, nr, amount_open FROM documents WHERE kind = 'invoice' AND status IN ('open','partial') AND contact_id = ? ORDER BY due_date",
      out.contact.id,
    );
    const cents = parse.amount ? toCents(parse.amount) : null;
    out.invoice = (cents ? open.find((i) => i.amount_open === cents) : undefined) ?? open[0] ?? null;
  }
  return out;
}

export async function planQuick(ctx: Ctx, text: string): Promise<QuickPlan | null> {
  const parse = parseQuick(text, today());
  if (!parse) return null;
  const r = await resolve(ctx, parse);
  const warnings: Msg[] = [];
  const date = parse.date ?? today();

  switch (parse.intent) {
    case "invoice":
    case "quote": {
      if (!r.contact) warnings.push(parse.who ? msg("No contact called “{name}” yet — I’ll create one.", { name: parse.who }) : msg("Who is it for? Add a customer name."));
      if (!r.positions?.length) warnings.push(msg("Add what you’re billing, e.g. “3h consulting at 180”."));
      for (const p of r.positions ?? []) if (!p.unit_price) warnings.push(msg("No price for “{item}” — it will be 0.00.", { item: p.text }));
      const calc = calculateDocument((r.positions ?? []).map((p) => ({ type: "custom", ...p })), "excl", 0.05);
      return {
        intent: parse.intent,
        headline: parse.intent === "invoice" ? msg("Invoice for {name}", { name: r.contact?.name ?? parse.who ?? "?" }) : msg("Quote for {name}", { name: r.contact?.name ?? parse.who ?? "?" }),
        details: (r.positions ?? []).map((p) => msg("{qty} {unit} {item} × {price}", { qty: p.quantity, unit: p.unit_name ?? "×", item: p.text, price: formatAmount(toCents(p.unit_price)) })),
        warnings,
        total: calc.total,
        actions:
          parse.intent === "invoice"
            ? [
                { id: "issue", label: msg("Create & issue"), primary: true },
                { id: "draft", label: msg("Save as draft") },
              ]
            : [
                { id: "issue", label: msg("Create & issue"), primary: true },
                { id: "draft", label: msg("Save as draft") },
              ],
      };
    }
    case "expense": {
      if (!parse.amount) warnings.push(msg("How much was it? Add an amount, e.g. “paid 12.50 for coffee”."));
      const cat = categorize(parse.text ?? "");
      return {
        intent: "expense",
        headline: msg("Receipt: {text}", { text: parse.text ?? "?" }),
        details: [
          msg("{emoji} Filed under {category}", { emoji: cat.emoji, category: cat.label }),
          msg("Paid on {date} from the bank account", { date: formatDate(date) }),
        ],
        warnings,
        total: parse.amount ? toCents(parse.amount) : undefined,
        actions: [
          { id: "book", label: msg("Book it"), primary: true },
          { id: "draft", label: msg("Save as draft") },
        ],
      };
    }
    case "time": {
      if (!r.project) warnings.push(parse.who ? msg("No active project matches “{name}” — I’ll log it without a project.", { name: parse.who }) : msg("Tip: add “on <project>”."));
      return {
        intent: "time",
        headline: msg("{duration} on {project}", { duration: formatDuration(parse.minutes ?? 0), project: r.project?.name ?? parse.who ?? "—" }),
        details: [msg("{date}{text}", { date: formatDate(date), text: parse.text ? ` · ${parse.text}` : "" }), ...(r.activity ? [msg("Activity: {activity}", { activity: r.activity.name }) as Msg] : [])],
        warnings,
        actions: [{ id: "log", label: msg("Log time"), primary: true }],
      };
    }
    case "payment": {
      if (!r.contact) warnings.push(msg("I don’t know “{name}”.", { name: parse.who ?? "?" }));
      else if (!r.invoice) warnings.push(msg("{name} has no open invoices.", { name: r.contact.name }));
      const amount = parse.amount ? toCents(parse.amount) : (r.invoice?.amount_open ?? 0);
      return {
        intent: "payment",
        headline: msg("{name} paid {amount}", { name: r.contact?.name ?? parse.who ?? "?", amount: formatAmount(amount) }),
        details: r.invoice ? [msg("Settles {nr} (open {open})", { nr: r.invoice.nr ?? `#${r.invoice.id}`, open: formatAmount(r.invoice.amount_open) })] : [],
        warnings,
        total: amount,
        actions: r.invoice ? [{ id: "record", label: msg("Record payment"), primary: true }] : [],
      };
    }
    case "bill": {
      if (!parse.amount) warnings.push(msg("Add the amount of the bill."));
      if (!r.contact) warnings.push(msg("No supplier called “{name}” yet — I’ll create one.", { name: parse.who ?? "?" }));
      const due = addDays(date, parse.dueInDays ?? 30);
      return {
        intent: "bill",
        headline: msg("Bill from {name}", { name: r.contact?.name ?? parse.who ?? "?" }),
        details: [msg("Due {date}", { date: formatDate(due) }), ...(parse.text ? [[parse.text] as Msg] : [])],
        warnings,
        total: parse.amount ? toCents(parse.amount) : undefined,
        actions: [
          { id: "book", label: msg("Create & book"), primary: true },
          { id: "draft", label: msg("Save as draft") },
        ],
      };
    }
    case "contact": {
      if (r.contact) warnings.push(msg("{name} already exists.", { name: r.contact.name }));
      const where = [parse.street && `${parse.street} ${parse.houseNumber ?? ""}`.trim(), parse.postcode && `${parse.postcode} ${parse.city ?? ""}`.trim(), parse.email].filter(Boolean).join(" · ");
      return {
        intent: "contact",
        headline: [parse.text === "supplier" ? "New supplier: {name}" : "New customer: {name}", { name: parse.who ?? "?" }],
        details: where ? [[where]] : [],
        warnings,
        actions: r.contact ? [] : [{ id: "create", label: msg("Create contact"), primary: true }],
      };
    }
    case "task":
      return {
        intent: "task",
        headline: msg("To-do: {text}", { text: parse.text ?? "?" }),
        details: parse.date ? [msg("Due {date}", { date: formatDate(parse.date) })] : [],
        warnings,
        actions: [{ id: "create", label: msg("Add to-do"), primary: true }],
      };
  }
}

async function ensureContact(ctx: Ctx, r: Resolved, supplier: boolean): Promise<number> {
  if (r.contact) return r.contact.id;
  if (!r.parse.who) throw new AppError("validation", "Who is it for? Add a customer name.");
  const created = await createRecord(ctx, getResource("contacts")!, { type: "company", name_1: r.parse.who, is_customer: !supplier, is_supplier: supplier });
  return Number(created.id);
}

export async function runQuick(ctx: Ctx, text: string, actionId: string): Promise<QuickOutcome> {
  const parse = parseQuick(text, today());
  if (!parse) throw new AppError("validation", "I didn’t understand that. Try “invoice Muster AG 3h consulting at 180”.");
  const r = await resolve(ctx, parse);
  const date = parse.date ?? today();

  switch (parse.intent) {
    case "invoice":
    case "quote": {
      if (!r.positions?.length) throw new AppError("validation", "Add what you’re billing, e.g. “3h consulting at 180”.");
      const resource = parse.intent === "invoice" ? "invoices" : "quotes";
      const res = getResource(resource)!;
      const contactId = await ensureContact(ctx, r, false);
      const doc = await createRecord(ctx, res, {
        contact_id: contactId,
        date,
        positions: r.positions.map((p) => ({ type: p.item_id ? "item" : "custom", item_id: p.item_id, text: p.text, quantity: p.quantity, unit_name: p.unit_name, unit_price: p.unit_price, tax_id: p.tax_id })),
      });
      if (actionId === "issue") await runAction(ctx, res, Number(doc.id), "issue");
      const fresh = await getRecord(ctx, res, Number(doc.id), false);
      return {
        message: actionId === "issue"
          ? msg("{nr} is ready — booked and waiting for {amount}.", { nr: String(fresh.nr ?? ""), amount: formatAmount(Number(fresh.total)) })
          : msg("Draft {nr} saved.", { nr: String(fresh.nr ?? "") }),
        record: { resource, id: Number(doc.id), label: String(fresh.nr ?? "") },
        celebrate: actionId === "issue",
      };
    }
    case "expense": {
      if (!parse.amount) throw new AppError("validation", "How much was it? Add an amount, e.g. “paid 12.50 for coffee”.");
      const cat = categorize(parse.text ?? "");
      const res = getResource("expenses")!;
      const taxId = cat.taxCode ? await ctx.db.value<number>("SELECT id FROM taxes WHERE code = ?", cat.taxCode) : null;
      const expense = await createRecord(ctx, res, {
        title: (parse.text ?? "Expense").replace(/^./, (c) => c.toUpperCase()),
        date,
        amount: parse.amount,
        tax_id: taxId,
        account_id: await accountIdByNumber(ctx, cat.accountNumber),
        payment_account_id: await accountIdByNumber(ctx, "1020"),
      });
      if (actionId === "book") await bookExpense(ctx, await getRecord(ctx, res, Number(expense.id)));
      return {
        message: msg("{amount} filed under {category}.", { amount: formatAmount(toCents(parse.amount)), category: cat.label }),
        record: { resource: "expenses", id: Number(expense.id), label: String(expense.title) },
      };
    }
    case "time": {
      const res = getResource("timesheets")!;
      const entry = await createRecord(ctx, res, {
        date,
        duration_minutes: parse.minutes,
        project_id: r.project?.id ?? null,
        activity_id: r.activity?.id ?? null,
        description: parse.text,
      });
      return {
        message: msg("{duration} logged{project}.", { duration: formatDuration(parse.minutes ?? 0), project: r.project ? ` · ${r.project.name}` : "" }),
        record: { resource: "timesheets", id: Number(entry.id), label: formatDuration(parse.minutes ?? 0) },
      };
    }
    case "payment": {
      if (!r.invoice) throw new AppError("validation", "There is no open invoice to settle.");
      const res = getResource("invoices")!;
      const amount = parse.amount ?? r.invoice.amount_open / 100;
      await runAction(ctx, res, r.invoice.id, "record_payment", { date, amount });
      const fresh = await getRecord(ctx, res, r.invoice.id, false);
      return {
        message: fresh.status === "paid"
          ? msg("{nr} is fully paid. 🎉", { nr: String(fresh.nr ?? "") })
          : msg("Payment recorded on {nr}; {open} still open.", { nr: String(fresh.nr ?? ""), open: formatAmount(Number(fresh.amount_open)) }),
        record: { resource: "invoices", id: r.invoice.id, label: String(fresh.nr ?? "") },
        celebrate: fresh.status === "paid",
      };
    }
    case "bill": {
      if (!parse.amount) throw new AppError("validation", "Add the amount of the bill.");
      const res = getResource("bills")!;
      const supplierId = await ensureContact(ctx, r, true);
      const cat = categorize(`${parse.who ?? ""} ${parse.text ?? ""}`);
      const taxId = cat.taxCode ? await ctx.db.value<number>("SELECT id FROM taxes WHERE code = ?", cat.taxCode) : null;
      const bill = await createRecord(ctx, res, {
        contact_id: supplierId,
        title: parse.text ?? cat.label,
        date,
        due_date: addDays(date, parse.dueInDays ?? 30),
        lines: [{ text: parse.text ?? cat.label, amount: parse.amount, tax_id: taxId, account_id: await accountIdByNumber(ctx, cat.accountNumber) }],
      });
      if (actionId === "book") await runAction(ctx, res, Number(bill.id), "book");
      return {
        message: actionId === "book" ? msg("Bill {nr} booked — I’ll remind you before it’s due.", { nr: String(bill.nr ?? "") }) : msg("Bill {nr} saved as draft.", { nr: String(bill.nr ?? "") }),
        record: { resource: "bills", id: Number(bill.id), label: String(bill.nr ?? "") },
      };
    }
    case "contact": {
      if (r.contact) throw new AppError("conflict", "{name} already exists.", undefined, { name: r.contact.name });
      const res = getResource("contacts")!;
      const c = await createRecord(ctx, res, {
        type: "company",
        name_1: parse.who,
        street: parse.street,
        house_number: parse.houseNumber,
        postcode: parse.postcode,
        city: parse.city,
        email: parse.email,
        phone: parse.phone,
        is_customer: parse.text !== "supplier",
        is_supplier: parse.text === "supplier",
      });
      return { message: msg("{name} added.", { name: String(parse.who) }), record: { resource: "contacts", id: Number(c.id), label: String(parse.who) } };
    }
    case "task": {
      const res = getResource("tasks")!;
      const task = await createRecord(ctx, res, { subject: parse.text, due_date: parse.date, assignee_name: ctx.user?.name ?? null, assignee_user_id: ctx.user?.id ?? null });
      return { message: msg("Added to your to-dos."), record: { resource: "tasks", id: Number(task.id), label: String(parse.text) } };
    }
  }
}
