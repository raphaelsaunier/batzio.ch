import { addDays, formatAmount, formatDate, formatDuration, today } from "@/lib/format";
import { monthName, msg, type Locale, type Msg } from "@/lib/i18n";
import type { InboxItem } from "@/lib/agent/inbox";
import { canCtx, type Ctx } from "./ctx";
import { liquidityForecast } from "./dashboard";
import { getSettings } from "./settings";

/**
 * “Needs you”: the short list of things only a human can decide, each with
 * the one click that settles it. Everything else Batzi does on its own.
 */
export type NudgeActionKind = "link" | "record_action" | "remind_overdue" | "ask" | "process_inbox" | "dismiss_inbox";

export interface NudgeAction {
  kind: NudgeActionKind;
  label: Msg;
  href?: string;
  resource?: string;
  id?: number;
  action?: string;
  prompt?: Msg;
  fileId?: number | null;
  inboxId?: number;
  primary?: boolean;
  /** Needs the agent (hidden when none is configured). */
  agent?: boolean;
}

export interface Nudge {
  key: string;
  icon: string;
  tone: "info" | "warning" | "danger" | "success";
  title: Msg;
  text?: Msg;
  amount?: number;
  actions: NudgeAction[];
}

const NAME = "CASE WHEN c.type = 'person' THEN trim(coalesce(c.name_2,'') || ' ' || c.name_1) ELSE c.name_1 END";

function inboxNudge(base: string, item: InboxItem): Nudge {
  const email = item.source === "email";
  const failed = item.status === "failed";
  return {
    key: `inbox-${item.id}`,
    icon: email ? "Mail" : item.file_id ? "FileText" : "Inbox",
    tone: failed ? "danger" : item.status === "needs_you" ? "warning" : "info",
    title: email ? msg("Email from {sender}: {subject}", { sender: item.sender ?? "?", subject: item.subject ?? item.title }) : msg("{name} is waiting", { name: item.title }),
    text: item.status === "processing" ? msg("Batzi is working on it…") : failed ? msg("Something went wrong: {error}", { error: item.error ?? "" }) : item.result ? [item.result.slice(0, 220)] : item.error ? [item.error] : msg("Dropped in — not handled yet."),
    actions: [
      ...(item.status !== "processing" ? [{ kind: "process_inbox" as const, label: item.thread_id ? msg("Continue with Batzi") : msg("Let Batzi handle it"), fileId: item.file_id, inboxId: item.id, primary: true, agent: true }] : []),
      ...(item.file_id ? [{ kind: "link" as const, label: msg("Make it a bill"), href: `${base}/bills/new?file_id=${item.file_id}` }, { kind: "link" as const, label: msg("View file"), href: `/api/v1/files/${item.file_id}/download?tenant=${base.slice(1)}` }] : []),
      { kind: "dismiss_inbox", label: msg("Done"), inboxId: item.id },
    ],
  };
}

export async function getNudges(ctx: Ctx, base: string, locale: Locale): Promise<Nudge[]> {
  const t = today();
  const out: Nudge[] = [];

  if (canCtx(ctx, "files", "read")) {
    const items = await ctx.db.all<InboxItem>("SELECT * FROM inbox_items WHERE status IN ('new','needs_you','failed','processing') ORDER BY id DESC LIMIT 6");
    for (const item of items) out.push(inboxNudge(base, item));
  }

  if (canCtx(ctx, "banking", "write")) {
    const suggested = await ctx.db.all<{ id: number; amount: number; counterparty: string | null; booking_date: string; match_type: string; match_id: number; nr: string | null }>(
      `SELECT t.id, t.amount, t.counterparty, t.booking_date, t.match_type, t.match_id,
              CASE WHEN t.match_type = 'invoice' THEN (SELECT nr FROM documents WHERE id = t.match_id) ELSE (SELECT 'payment #' || id FROM outgoing_payments WHERE id = t.match_id) END AS nr
       FROM bank_transactions t WHERE t.status = 'suggested' ORDER BY t.booking_date DESC LIMIT 5`,
    );
    for (const s of suggested) {
      out.push({
        key: `match-${s.id}`,
        icon: "Sparkles",
        tone: "info",
        title: s.amount >= 0 ? msg("{amount} from {who} — that’s {nr}, right?", { amount: formatAmount(s.amount), who: s.counterparty ?? "?", nr: s.nr ?? "?" }) : msg("{amount} to {who} — that’s {nr}, right?", { amount: formatAmount(-s.amount), who: s.counterparty ?? "?", nr: s.nr ?? "?" }),
        text: msg("Bank line from {date}.", { date: formatDate(s.booking_date) }),
        actions: [
          { kind: "record_action", label: msg("Yes, book it"), resource: "bank_transactions", id: s.id, action: "book_suggestion", primary: true },
          { kind: "link", label: msg("Look closer"), href: `${base}/bank_transactions/${s.id}` },
        ],
      });
    }
    const unmatched = await ctx.db.first<{ n: number; total: number }>("SELECT count(*) AS n, coalesce(sum(abs(amount)),0) AS total FROM bank_transactions WHERE status = 'unmatched'");
    if (unmatched && unmatched.n > 0) {
      out.push({
        key: "unmatched",
        icon: "Landmark",
        tone: "warning",
        title: msg("{n} bank lines need a home", { n: unmatched.n }),
        text: msg("Money moved, but Batzi couldn’t tell what for."),
        actions: [
          { kind: "ask", label: msg("Sort them with Batzi"), prompt: msg("Go through the unmatched bank lines, book what is obvious and ask me about the rest."), primary: true, agent: true },
          { kind: "link", label: msg("Show them"), href: `${base}/bank_transactions?status=unmatched` },
        ],
      });
    }
  }

  if (canCtx(ctx, "sales", "read")) {
    const overdue = await ctx.db.first<{ n: number; total: number }>("SELECT count(*) AS n, coalesce(sum(amount_open),0) AS total FROM documents WHERE kind = 'invoice' AND status IN ('open','partial') AND due_date < ?", t);
    if (overdue && overdue.n > 0) {
      out.push({
        key: "overdue",
        icon: "AlarmClock",
        tone: "danger",
        title: msg("{n} invoices are late", { n: overdue.n }),
        text: msg("Together that’s CHF {amount} you’re still waiting for.", { amount: formatAmount(overdue.total) }),
        amount: overdue.total,
        actions: [
          ...(canCtx(ctx, "sales", "write") ? [{ kind: "remind_overdue" as const, label: msg("Nudge them all"), primary: true }] : []),
          { kind: "link", label: msg("Who?"), href: `${base}/invoices?status=open&due_date_lt=${t}` },
        ],
      });
    }
    const drafts = await ctx.db.value<number>("SELECT count(*) FROM documents WHERE kind = 'invoice' AND status = 'draft'");
    if (drafts) {
      out.push({ key: "drafts", icon: "FilePen", tone: "info", title: msg("{n} invoice drafts are waiting", { n: drafts }), text: msg("Check them and send them off — money doesn’t invoice itself."), actions: [{ kind: "link", label: msg("Review drafts"), href: `${base}/invoices?status=draft`, primary: true }] });
    }
  }

  if (canCtx(ctx, "purchases", "read")) {
    const soon = await ctx.db.first<{ n: number; total: number }>(
      `SELECT count(*) AS n, coalesce(sum(b.amount_open),0) AS total FROM bills b
       WHERE b.status IN ('booked','partial') AND b.due_date <= ? AND NOT EXISTS (SELECT 1 FROM outgoing_payments o WHERE o.bill_id = b.id AND o.status IN ('open','exported'))`,
      addDays(t, 10),
    );
    if (soon && soon.n > 0) {
      out.push({
        key: "bills-due",
        icon: "CalendarClock",
        tone: "warning",
        title: msg("{n} bills are due within 10 days", { n: soon.n }),
        text: msg("CHF {amount} in total. Schedule them and pay everything with one e-banking upload.", { amount: formatAmount(soon.total) }),
        amount: soon.total,
        actions: [
          { kind: "ask", label: msg("Schedule payments"), prompt: msg("Schedule payments for all bills due within the next 10 days, then tell me the total."), primary: true, agent: true },
          { kind: "link", label: msg("See bills"), href: `${base}/bills?status=booked` },
        ],
      });
    }
    const draftBills = await ctx.db.value<number>("SELECT (SELECT count(*) FROM bills WHERE status = 'draft') + (SELECT count(*) FROM expenses WHERE status = 'draft')");
    if (draftBills) {
      out.push({ key: "draft-bills", icon: "FileInput", tone: "info", title: msg("{n} bills or receipts to check", { n: draftBills }), text: msg("Batzi couldn’t read everything for sure. A quick look, then book."), actions: [{ kind: "link", label: msg("Check them"), href: `${base}/bills?status=draft`, primary: true }] });
    }
  }

  if (canCtx(ctx, "projects", "read")) {
    const unbilled = await ctx.db.first<{ minutes: number; value: number }>(
      `SELECT coalesce(sum(t.duration_minutes),0) AS minutes,
              coalesce(sum(t.duration_minutes * coalesce(t.hourly_rate, a.hourly_rate, 0) / 60.0),0) AS value
       FROM timesheets t LEFT JOIN business_activities a ON a.id = t.activity_id
       WHERE t.is_billable = 1 AND t.status = 'open' AND t.document_id IS NULL`,
    );
    if (unbilled && unbilled.minutes >= 60) {
      out.push({
        key: "unbilled",
        icon: "Timer",
        tone: "info",
        title: msg("{duration} of work not invoiced yet", { duration: formatDuration(unbilled.minutes) }),
        text: unbilled.value ? msg("Worth about CHF {amount}. Just saying.", { amount: formatAmount(Math.round(unbilled.value * 100)) }) : msg("Billable hours are piling up."),
        actions: [
          { kind: "ask", label: msg("Invoice it"), prompt: msg("Create draft invoices for all unbilled billable time, one per customer, and show me the totals."), primary: true, agent: true },
          { kind: "link", label: msg("See time"), href: `${base}/timesheets?status=open` },
        ],
      });
    }
  }

  if (canCtx(ctx, "accounting", "read")) {
    const accounting = await getSettings(ctx, "accounting");
    if (accounting.vat_registered) {
      const due = await ctx.db.first<{ id: number; name: string; end_date: string }>("SELECT id, name, end_date FROM vat_periods WHERE status = 'open' AND end_date < ? ORDER BY end_date LIMIT 1", t);
      if (due) {
        const deadline = addDays(due.end_date, 60);
        out.push({
          key: "vat",
          icon: "Percent",
          tone: deadline < addDays(t, 14) ? "danger" : "warning",
          title: msg("VAT for {period} is due by {date}", { period: due.name, date: formatDate(deadline) }),
          text: msg("The form is filled in already. You check, Batzi books."),
          actions: [{ kind: "link", label: msg("Open VAT report"), href: `${base}/vat_periods/${due.id}`, primary: true }],
        });
      }
    }
  }

  if (canCtx(ctx, "payroll", "read")) {
    const day = Number(t.slice(8, 10));
    const [y, m] = [Number(t.slice(0, 4)), Number(t.slice(5, 7))];
    if (day >= 20) {
      const active = await ctx.db.value<number>("SELECT count(*) FROM employees WHERE is_active = 1");
      const done = await ctx.db.value<number>("SELECT count(*) FROM payslips WHERE year = ? AND month = ?", y, m);
      if (active && !done) {
        out.push({
          key: "payroll",
          icon: "Users",
          tone: "warning",
          title: msg("Salaries for {month}", { month: monthName(m, locale, "long") }),
          text: msg("{n} people are counting on you. Batzi does the deductions.", { n: active }),
          actions: [{ kind: "link", label: msg("Run payroll"), href: `${base}/payroll`, primary: true }],
        });
      }
    }
  }

  if (canCtx(ctx, "settings", "write")) {
    const company = await getSettings(ctx, "company");
    const iban = await ctx.db.value<string>("SELECT coalesce(qr_iban, iban) FROM bank_accounts WHERE coalesce(qr_iban, iban) IS NOT NULL LIMIT 1");
    if (!company.street || !company.postcode || !iban) {
      out.push({
        key: "setup",
        icon: "Wand2",
        tone: "info",
        title: msg("Your invoices are missing a few details"),
        text: msg("A QR-bill needs your address and an IBAN. Tell Batzi, or drop your letterhead."),
        actions: [
          { kind: "ask", label: msg("Set it up with Batzi"), prompt: msg("Help me complete the company details for QR-bills: ask me for whatever is missing."), primary: true, agent: true },
          { kind: "link", label: msg("Settings"), href: `${base}/settings` },
        ],
      });
    }
  }
  return out;
}

export interface MoneyWeather {
  mood: "sunny" | "cloudy" | "rainy";
  cash: number;
  incoming: number;
  outgoing: number;
  low: { balance: number; week: string };
  weeks: { week: string; balance: number }[];
}

/** Cash today and the next eight weeks, as weather. */
export async function moneyWeather(ctx: Ctx): Promise<MoneyWeather> {
  const f = await liquidityForecast(ctx, 8);
  const low = f.weeks.reduce((min, w) => (w.balance < min.balance ? w : min), { week: today(), balance: f.opening, receipts: 0, payments: 0 });
  const end = f.weeks.at(-1)?.balance ?? f.opening;
  const mood = low.balance < 0 ? "rainy" : end < f.opening * 0.85 ? "cloudy" : "sunny";
  return {
    mood,
    cash: f.opening,
    incoming: f.weeks.reduce((s, w) => s + w.receipts, 0),
    outgoing: f.weeks.reduce((s, w) => s + w.payments, 0),
    low: { balance: low.balance, week: low.week },
    weeks: [{ week: today(), balance: f.opening }, ...f.weeks.map((w) => ({ week: w.week, balance: w.balance }))],
  };
}
