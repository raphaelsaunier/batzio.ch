import { roundTo } from "@batzio/core/money";
import { getResource } from "./resources/registry";
import type { Row } from "./resources/types";
import { createRecord } from "./crud";
import type { Ctx } from "./ctx";
import { placeholders } from "./db/db";
import { AppError } from "./errors";

interface TimesheetRow {
  id: number;
  duration_minutes: number;
  hourly_rate: number | null;
  activity_id: number | null;
  activity_name: string | null;
  activity_rate: number | null;
  description: string | null;
  date: string;
}

/** Creates a draft invoice from all unbilled, billable time of a project. */
export async function invoiceProjectTime(ctx: Ctx, project: Row, options: { until?: string | null } = {}): Promise<Row> {
  const rows = await ctx.db.all<TimesheetRow>(
    `SELECT t.id, t.duration_minutes, t.hourly_rate, t.activity_id, t.description, t.date,
            a.name AS activity_name, a.hourly_rate AS activity_rate
     FROM timesheets t LEFT JOIN business_activities a ON a.id = t.activity_id
     WHERE t.project_id = ? AND t.is_billable = 1 AND t.status != 'billed' AND t.document_id IS NULL
       ${options.until ? "AND t.date <= ?" : ""}
     ORDER BY t.date`,
    project.id,
    ...(options.until ? [options.until] : []),
  );
  if (!rows.length) throw new AppError("conflict", "There is no unbilled billable time on this project.");
  const projectRate = Number(project.hourly_rate ?? 0);
  const groups = new Map<string, { label: string; minutes: number; rate: number; from: string; to: string }>();
  for (const r of rows) {
    const rate = Number(r.hourly_rate ?? r.activity_rate ?? projectRate);
    const key = `${r.activity_id ?? 0}:${rate}`;
    const g = groups.get(key) ?? { label: r.activity_name ?? "Services", minutes: 0, rate, from: r.date, to: r.date };
    g.minutes += r.duration_minutes;
    g.to = r.date;
    groups.set(key, g);
  }
  const invoice = await createRecord(
    ctx,
    getResource("invoices")!,
    {
      title: `${project.name}`,
      contact_id: project.contact_id,
      contact_person_id: project.contact_person_id,
      project_id: project.id,
      positions: [...groups.values()].map((g) => ({
        type: "custom",
        text: `${g.label} (${g.from === g.to ? g.from : `${g.from} – ${g.to}`})`,
        quantity: roundTo(g.minutes / 60, 2),
        unit_name: "h",
        unit_price: g.rate,
      })),
    },
    { trusted: true, auditSummary: `Invoice created from ${rows.length} timesheet entries of project ${project.name}` },
  );
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    await ctx.db.run(
      `UPDATE timesheets SET status = 'billed', document_id = ?, updated_by = ? WHERE id IN (${placeholders(chunk.length)})`,
      invoice.id,
      ctx.actor.name,
      ...chunk,
    );
  }
  return invoice;
}

export interface ProjectStats {
  minutes: number;
  billableMinutes: number;
  unbilledMinutes: number;
  invoiced: number;
  costs: number;
  budgetUsedPercent: number | null;
}

export async function projectStats(ctx: Ctx, project: Row): Promise<ProjectStats> {
  const time = await ctx.db.first<{ minutes: number | null; billable: number | null; unbilled: number | null; value: number | null }>(
    `SELECT SUM(duration_minutes) AS minutes,
            SUM(CASE WHEN is_billable = 1 THEN duration_minutes ELSE 0 END) AS billable,
            SUM(CASE WHEN is_billable = 1 AND status != 'billed' THEN duration_minutes ELSE 0 END) AS unbilled,
            SUM(duration_minutes * COALESCE(hourly_rate, ?) / 60.0) AS value
     FROM timesheets WHERE project_id = ?`,
    Number(project.hourly_rate ?? 0),
    project.id,
  );
  const invoiced =
    (await ctx.db.value<number>(
      "SELECT COALESCE(SUM(total_net), 0) FROM documents WHERE kind = 'invoice' AND project_id = ? AND status NOT IN ('draft','cancelled')",
      project.id,
    )) ?? 0;
  const costs =
    ((await ctx.db.value<number>("SELECT COALESCE(SUM(total_net), 0) FROM bills WHERE project_id = ? AND status NOT IN ('draft','cancelled')", project.id)) ?? 0) +
    ((await ctx.db.value<number>("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE project_id = ? AND status = 'booked'", project.id)) ?? 0);
  let budgetUsedPercent: number | null = null;
  if (project.budget_type === "hours" && Number(project.budget_hours)) {
    budgetUsedPercent = roundTo(((time?.minutes ?? 0) / 60 / Number(project.budget_hours)) * 100, 1);
  } else if (project.budget_type === "amount" && Number(project.budget_amount)) {
    budgetUsedPercent = roundTo((((time?.value ?? 0) * 100) / Number(project.budget_amount)) * 100, 1);
  }
  return {
    minutes: time?.minutes ?? 0,
    billableMinutes: time?.billable ?? 0,
    unbilledMinutes: time?.unbilled ?? 0,
    invoiced,
    costs,
    budgetUsedPercent,
  };
}
