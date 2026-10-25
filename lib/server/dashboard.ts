import { addDays, addMonths, today } from "@/lib/format";
import type { Ctx } from "./ctx";
import { vatReport } from "./accounting";

export interface Dashboard {
  asOf: string;
  revenueYtd: number;
  expensesYtd: number;
  profitYtd: number;
  cash: number;
  receivables: { open: number; count: number; overdue: number; overdueCount: number };
  payables: { open: number; count: number; dueSoon: number };
  unbilled: { minutes: number; value: number };
  vat: { from: string; to: string; payable: number };
  monthly: { month: string; revenue: number; expenses: number }[];
  topCustomers: { id: number; name: string; revenue: number }[];
  overdueInvoices: { id: number; nr: string | null; contact: string | null; due_date: string; amount_open: number }[];
  upcomingBills: { id: number; nr: string | null; contact: string | null; due_date: string | null; amount_open: number }[];
  tasks: { id: number; subject: string; due_date: string | null; priority: string }[];
  activity: { id: number; at: string; actor_name: string | null; summary: string | null; source: string }[];
}

const CONTACT_NAME = "CASE WHEN c.type = 'person' THEN trim(coalesce(c.name_2,'') || ' ' || c.name_1) ELSE c.name_1 END";

export async function getDashboard(ctx: Ctx): Promise<Dashboard> {
  const t = today();
  const yearStart = `${t.slice(0, 4)}-01-01`;
  const quarterStartMonth = Math.floor((Number(t.slice(5, 7)) - 1) / 3) * 3 + 1;
  const qFrom = `${t.slice(0, 4)}-${String(quarterStartMonth).padStart(2, "0")}-01`;
  const qTo = addDays(addMonths(qFrom, 3), -1);
  const notClosing = "p.entry_id NOT IN (SELECT id FROM journal_entries WHERE type = 'closing')";

  const pl = await ctx.db.first<{ revenue: number | null; expenses: number | null }>(
    `SELECT SUM(CASE WHEN a.type = 'revenue' THEN p.credit - p.debit ELSE 0 END) AS revenue,
            SUM(CASE WHEN a.type = 'expense' THEN p.debit - p.credit ELSE 0 END) AS expenses
     FROM postings p JOIN accounts a ON a.id = p.account_id
     WHERE p.date BETWEEN ? AND ? AND ${notClosing}`,
    yearStart,
    t,
  );
  const cash =
    (await ctx.db.value<number>(
      `SELECT SUM(p.debit - p.credit) FROM postings p JOIN accounts a ON a.id = p.account_id
       WHERE (a.number BETWEEN '1000' AND '1099' OR a.id IN (SELECT account_id FROM bank_accounts)) AND p.date <= ?`,
      t,
    )) ?? 0;
  const receivables = await ctx.db.first<{ open: number | null; count: number; overdue: number | null; overdue_count: number | null }>(
    `SELECT SUM(amount_open) AS open, COUNT(*) AS count,
            SUM(CASE WHEN due_date < ? THEN amount_open ELSE 0 END) AS overdue,
            SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS overdue_count
     FROM documents WHERE kind = 'invoice' AND status IN ('open','partial')`,
    t,
    t,
  );
  const payables = await ctx.db.first<{ open: number | null; count: number; due_soon: number | null }>(
    `SELECT SUM(amount_open) AS open, COUNT(*) AS count,
            SUM(CASE WHEN due_date <= ? THEN amount_open ELSE 0 END) AS due_soon
     FROM bills WHERE status IN ('booked','partial')`,
    addDays(t, 14),
  );
  const unbilled = await ctx.db.first<{ minutes: number | null; value: number | null }>(
    `SELECT SUM(t.duration_minutes) AS minutes,
            SUM(t.duration_minutes * COALESCE(t.hourly_rate, a.hourly_rate, p.hourly_rate, 0) / 60.0) AS value
     FROM timesheets t LEFT JOIN business_activities a ON a.id = t.activity_id LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.is_billable = 1 AND t.status != 'billed'`,
  );
  const vat = await vatReport(ctx, qFrom, qTo);

  const from12 = `${addMonths(`${t.slice(0, 7)}-01`, -11)}`;
  const monthlyRows = await ctx.db.all<{ month: string; revenue: number | null; expenses: number | null }>(
    `SELECT substr(p.date, 1, 7) AS month,
            SUM(CASE WHEN a.type = 'revenue' THEN p.credit - p.debit ELSE 0 END) AS revenue,
            SUM(CASE WHEN a.type = 'expense' THEN p.debit - p.credit ELSE 0 END) AS expenses
     FROM postings p JOIN accounts a ON a.id = p.account_id
     WHERE p.date >= ? AND p.date <= ? AND ${notClosing} GROUP BY month`,
    from12,
    t,
  );
  const monthly: Dashboard["monthly"] = [];
  for (let i = 0; i < 12; i++) {
    const month = addMonths(from12, i).slice(0, 7);
    const row = monthlyRows.find((r) => r.month === month);
    monthly.push({ month, revenue: row?.revenue ?? 0, expenses: row?.expenses ?? 0 });
  }

  const [topCustomers, overdueInvoices, upcomingBills, tasks, activity] = await Promise.all([
    ctx.db.all<{ id: number; name: string; revenue: number }>(
      `SELECT c.id, ${CONTACT_NAME} AS name, SUM(d.total_net) AS revenue
       FROM documents d JOIN contacts c ON c.id = d.contact_id
       WHERE d.kind = 'invoice' AND d.status NOT IN ('draft','cancelled') AND d.date >= ?
       GROUP BY c.id ORDER BY revenue DESC LIMIT 5`,
      yearStart,
    ),
    ctx.db.all<Dashboard["overdueInvoices"][number]>(
      `SELECT d.id, d.nr, ${CONTACT_NAME} AS contact, d.due_date, d.amount_open
       FROM documents d LEFT JOIN contacts c ON c.id = d.contact_id
       WHERE d.kind = 'invoice' AND d.status IN ('open','partial') AND d.due_date < ? ORDER BY d.due_date LIMIT 6`,
      t,
    ),
    ctx.db.all<Dashboard["upcomingBills"][number]>(
      `SELECT b.id, b.nr, ${CONTACT_NAME} AS contact, b.due_date, b.amount_open
       FROM bills b LEFT JOIN contacts c ON c.id = b.contact_id
       WHERE b.status IN ('booked','partial') ORDER BY b.due_date LIMIT 6`,
    ),
    ctx.db.all<Dashboard["tasks"][number]>(
      `SELECT id, subject, due_date, priority FROM tasks WHERE status IN ('todo','in_progress')
       ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, due_date LIMIT 6`,
    ),
    ctx.db.all<Dashboard["activity"][number]>(
      "SELECT id, at, actor_name, summary, source FROM audit_log ORDER BY id DESC LIMIT 8",
    ),
  ]);

  const revenueYtd = pl?.revenue ?? 0;
  const expensesYtd = pl?.expenses ?? 0;
  return {
    asOf: t,
    revenueYtd,
    expensesYtd,
    profitYtd: revenueYtd - expensesYtd,
    cash,
    receivables: {
      open: receivables?.open ?? 0,
      count: receivables?.count ?? 0,
      overdue: receivables?.overdue ?? 0,
      overdueCount: receivables?.overdue_count ?? 0,
    },
    payables: { open: payables?.open ?? 0, count: payables?.count ?? 0, dueSoon: payables?.due_soon ?? 0 },
    unbilled: { minutes: unbilled?.minutes ?? 0, value: Math.round((unbilled?.value ?? 0) * 100) },
    vat: { from: qFrom, to: qTo, payable: vat.totals.payable },
    monthly,
    topCustomers,
    overdueInvoices,
    upcomingBills,
    tasks,
    activity,
  };
}

export interface ForecastWeek {
  week: string;
  receipts: number;
  payments: number;
  balance: number;
}

/** Weekly liquidity forecast: current liquid funds plus open receivables and payables by due date. */
export async function liquidityForecast(ctx: Ctx, weeks = 12): Promise<{ opening: number; weeks: ForecastWeek[] }> {
  const t = today();
  const opening =
    (await ctx.db.value<number>(
      `SELECT SUM(p.debit - p.credit) FROM postings p JOIN accounts a ON a.id = p.account_id
       WHERE (a.number BETWEEN '1000' AND '1099' OR a.id IN (SELECT account_id FROM bank_accounts)) AND p.date <= ?`,
      t,
    )) ?? 0;
  const receipts = await ctx.db.all<{ due: string | null; amount: number }>(
    "SELECT due_date AS due, amount_open AS amount FROM documents WHERE kind = 'invoice' AND status IN ('open','partial')",
  );
  const payments = await ctx.db.all<{ due: string | null; amount: number }>(
    `SELECT COALESCE(o.execution_date, b.due_date) AS due, b.amount_open AS amount FROM bills b
     LEFT JOIN (SELECT bill_id, MIN(execution_date) AS execution_date FROM outgoing_payments WHERE status IN ('open','exported') GROUP BY bill_id) o ON o.bill_id = b.id
     WHERE b.status IN ('booked','partial')`,
  );
  const out: ForecastWeek[] = [];
  let balance = opening;
  for (let i = 0; i < weeks; i++) {
    const start = addDays(t, i * 7);
    const end = addDays(t, i * 7 + 6);
    // Overdue items are expected in the first week.
    const inWeek = (due: string | null) => (i === 0 ? !due || due <= end : !!due && due >= start && due <= end);
    const r = receipts.filter((x) => inWeek(x.due)).reduce((s, x) => s + x.amount, 0);
    const p = payments.filter((x) => inWeek(x.due)).reduce((s, x) => s + x.amount, 0);
    balance += r - p;
    out.push({ week: start, receipts: r, payments: p, balance });
  }
  return { opening, weeks: out };
}

export interface OpenItem {
  id: number;
  nr: string | null;
  contact_id: number | null;
  contact: string | null;
  date: string;
  due_date: string | null;
  total: number;
  open: number;
  days_overdue: number;
  bucket: "current" | "1-30" | "31-60" | "61-90" | "90+";
}

/** Open receivables or payables with ageing buckets. */
export async function openItems(ctx: Ctx, type: "receivables" | "payables", asOf = today()): Promise<{ items: OpenItem[]; buckets: Record<OpenItem["bucket"], number> }> {
  const rows =
    type === "receivables"
      ? await ctx.db.all<Omit<OpenItem, "days_overdue" | "bucket">>(
          `SELECT d.id, d.nr, d.contact_id, ${CONTACT_NAME} AS contact, d.date, d.due_date, d.total, d.amount_open AS open
           FROM documents d LEFT JOIN contacts c ON c.id = d.contact_id
           WHERE d.kind = 'invoice' AND d.status IN ('open','partial') ORDER BY d.due_date`,
        )
      : await ctx.db.all<Omit<OpenItem, "days_overdue" | "bucket">>(
          `SELECT b.id, b.nr, b.contact_id, ${CONTACT_NAME} AS contact, b.date, b.due_date, b.total, b.amount_open AS open
           FROM bills b LEFT JOIN contacts c ON c.id = b.contact_id
           WHERE b.status IN ('booked','partial') ORDER BY b.due_date`,
        );
  const buckets: Record<OpenItem["bucket"], number> = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  const items = rows.map((r) => {
    const days = r.due_date ? Math.max(0, Math.round((Date.parse(asOf) - Date.parse(r.due_date)) / 86_400_000)) : 0;
    const bucket: OpenItem["bucket"] = days <= 0 ? "current" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
    buckets[bucket] += r.open;
    return { ...r, days_overdue: days, bucket };
  });
  return { items, buckets };
}
