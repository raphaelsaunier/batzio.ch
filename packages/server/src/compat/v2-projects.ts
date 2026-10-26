import { audit } from "../audit";
import { patchColumns } from "../crud";
import { assertCan, type Ctx } from "../ctx";
import { notFound } from "../errors";
import type { Row } from "../resources/types";
import { memberByNumber, userOf } from "./lookup";
import { createWire, crud, deleteWire, has, listWire, loadRow, pick, selectRows, updateWire, wire, type Mapping } from "./table";
import { codeList } from "./v2-contacts";
import { bodyObject, bool, created, date, dec, ok, pathId, route, uuidFor, TAG, type CompatCall, type Route } from "./wire";

export const PROJECT_STATE = codeList([
  ["active", "Active"],
  ["planned", "Open"],
  ["on_hold", "On hold"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
]);
export const PROJECT_TYPE = codeList([
  ["customer", "Customer project"],
  ["internal", "Internal project"],
]);
export const TIMESHEET_STATUS = codeList([
  ["open", "Open"],
  ["approved", "Approved"],
  ["billed", "Billed"],
]);

const at00 = (v: unknown) => (v ? `${date(v)} 00:00:00` : null);

export const projectMapping: Mapping = {
  table: "projects",
  area: "projects",
  resource: "projects",
  label: "Project",
  filter: () => ({ sql: "1 = 1" }),
  columns: {
    id: "id",
    nr: "nr",
    document_nr: "nr",
    name: "name",
    start_date: "start_date",
    end_date: "end_date",
    contact_id: "contact_id",
    pr_state_id: { sql: PROJECT_STATE.sql("status") },
    pr_project_type_id: { sql: PROJECT_TYPE.sql("type") },
    user_id: "responsible_user_id",
  },
  read: (r, ctx) => ({
    id: r.id,
    uuid: uuidFor(TAG.project, Number(r.id)),
    nr: r.nr ?? "",
    document_nr: r.nr ?? "",
    name: r.name,
    start_date: at00(r.start_date),
    end_date: at00(r.end_date),
    comment: r.description ?? "",
    pr_state_id: PROJECT_STATE.id(r.status) ?? 1,
    pr_project_type_id: PROJECT_TYPE.id(r.type) ?? 1,
    contact_id: r.contact_id ?? null,
    contact_sub_id: r.contact_person_id ?? null,
    pr_invoice_type_id: r.hourly_rate ? 3 : null,
    pr_invoice_type_amount: dec(r.hourly_rate ?? 0),
    pr_budget_type_id: r.budget_type === "amount" ? 1 : r.budget_type === "hours" ? 2 : null,
    pr_budget_type_amount: dec(r.budget_type === "hours" ? r.budget_hours : r.budget_type === "amount" ? Number(r.budget_amount ?? 0) / 100 : 0),
    user_id: userOf(ctx, r.responsible_user_id),
  }),
  write: async (b, ctx) => {
    const out = pick(b, {
      nr: "nr",
      document_nr: "nr",
      name: "name",
      start_date: (v) => ({ start_date: date(v) }),
      end_date: (v) => ({ end_date: date(v) }),
      comment: "description",
      pr_state_id: (v) => ({ status: PROJECT_STATE.code(v) ?? "active" }),
      pr_project_type_id: (v) => ({ type: PROJECT_TYPE.code(v) ?? "customer" }),
      contact_id: "contact_id",
      contact_sub_id: "contact_person_id",
      pr_invoice_type_amount: (v, body) => (Number(body.pr_invoice_type_id ?? 3) === 4 ? {} : { hourly_rate: Number(v) || null }),
      pr_budget_type_id: (v, body) => {
        const amount = Number(body.pr_budget_type_amount ?? 0);
        if (Number(v) === 2) return { budget_type: "hours", budget_hours: amount };
        if (v) return { budget_type: "amount", budget_amount: amount };
        return { budget_type: "none" };
      },
    });
    if (has(b, "user_id")) out.responsible_user_id = (await memberByNumber(ctx, b.user_id))?.user_id ?? ctx.user?.id;
    return out;
  },
};

/** "HH:MM" ↔ minutes. */
const hhmm = (minutes: unknown) => {
  const m = Math.max(0, Math.round(Number(minutes ?? 0)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const minutesOf = (v: unknown) => {
  const s = String(v ?? "");
  const m = /^(\d+):(\d{1,2})/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Math.round(Number(s) * 60) || 0;
};
const timeOf = (v: unknown) => (v ? String(v).replace("T", " ").slice(11, 16) || null : null);

export const timesheetMapping: Mapping = {
  table: "timesheets",
  area: "projects",
  resource: "timesheets",
  label: "Time entry",
  columns: {
    id: "id",
    date: "date",
    client_service_id: "activity_id",
    contact_id: "contact_id",
    pr_project_id: "project_id",
    pr_package_id: "work_package_id",
    allowable_bill: "is_billable",
    status_id: { sql: TIMESHEET_STATUS.sql("status") },
    text: "description",
  },
  extras: ["sub_contact_id", "pr_milestone_id", "travel_time", "travel_charge", "travel_distance", "estimated_time"],
  read: async (r, ctx) => {
    const tracking =
      r.start_time && r.end_time
        ? { type: "range", start: `${date(r.date)}T${r.start_time}:00+00:00`, end: `${date(r.date)}T${r.end_time}:00+00:00` }
        : { type: "duration", date: date(r.date), duration: hhmm(r.duration_minutes) };
    const milestone = r.work_package_id ? await ctx.db.value<number>("SELECT milestone_id FROM work_packages WHERE id = ?", r.work_package_id) : null;
    return {
      id: r.id,
      user_id: userOf(ctx, r.user_id),
      status_id: TIMESHEET_STATUS.id(r.status) ?? 1,
      client_service_id: r.activity_id ?? null,
      text: r.description ?? "",
      allowable_bill: bool(r.is_billable),
      charge: r.hourly_rate === null || r.hourly_rate === undefined ? null : dec(r.hourly_rate),
      contact_id: r.contact_id ?? null,
      sub_contact_id: null,
      pr_project_id: r.project_id ?? null,
      pr_package_id: r.work_package_id ?? null,
      pr_milestone_id: milestone ?? null,
      travel_time: null,
      travel_charge: null,
      travel_distance: 0,
      estimated_time: null,
      date: date(r.date),
      duration: hhmm(r.duration_minutes),
      running: false,
      tracking,
    };
  },
  write: async (b, ctx) => {
    const out = pick(b, {
      status_id: (v) => ({ status: TIMESHEET_STATUS.code(v) ?? "open" }),
      client_service_id: "activity_id",
      text: "description",
      allowable_bill: (v) => ({ is_billable: bool(v) }),
      charge: (v) => ({ hourly_rate: v === null || v === "" ? null : Number(v) }),
      contact_id: "contact_id",
      pr_project_id: "project_id",
      pr_package_id: "work_package_id",
      date: (v) => ({ date: date(v) }),
      duration: (v) => ({ duration_minutes: minutesOf(v) }),
    });
    const tracking = b.tracking as Row | undefined;
    if (tracking?.type === "range" && tracking.start && tracking.end) {
      out.date = date(tracking.start);
      out.start_time = timeOf(tracking.start);
      out.end_time = timeOf(tracking.end);
      out.duration_minutes = Math.max(0, Math.round((Date.parse(String(tracking.end)) - Date.parse(String(tracking.start))) / 60_000));
    } else if (tracking && (tracking.type === "duration" || tracking.type === "stopwatch")) {
      if (tracking.date) out.date = date(tracking.date);
      out.duration_minutes = minutesOf(tracking.duration);
    }
    if (has(b, "user_id")) {
      const member = await memberByNumber(ctx, b.user_id);
      out.user_id = member?.user_id ?? ctx.user?.id;
      out.user_name = member?.name ?? ctx.user?.name;
    }
    return out;
  },
};

export const milestoneMapping: Mapping = {
  table: "project_milestones",
  area: "projects",
  resource: "project_milestones",
  label: "Milestone",
  columns: { id: "id", name: "name", end_date: "due_date" },
  extras: ["pr_parent_milestone_id"],
  read: (r) => ({ id: r.id, name: r.name, end_date: date(r.due_date), comment: r.description ?? "", pr_parent_milestone_id: null }),
  write: (b) => pick(b, { name: "name", end_date: (v) => ({ due_date: date(v) }), comment: "description" }),
};

export const packageMapping: Mapping = {
  table: "work_packages",
  area: "projects",
  resource: "work_packages",
  label: "Work package",
  columns: { id: "id", name: "name" },
  read: async (r, ctx) => ({
    id: r.id,
    name: r.name,
    spent_time_in_hours: Number((await ctx.db.value<number>("SELECT coalesce(sum(duration_minutes), 0) FROM timesheets WHERE work_package_id = ?", r.id)) ?? 0) / 60,
    estimated_time_in_hours: Number(r.estimated_hours ?? 0),
    comment: r.description ?? "",
    pr_milestone_id: r.milestone_id ?? null,
  }),
  write: (b) => pick(b, { name: "name", estimated_time_in_hours: (v) => ({ estimated_hours: Number(v) }), comment: "description", pr_milestone_id: "milestone_id" }),
};

/** Child records under /3.0/projects/{project_id}/… */
function projectChildren(segment: string, idParam: string, m: Mapping, edit: "POST" | "PATCH"): Route[] {
  const base = `/3.0/projects/{project_id}/${segment}`;
  const item = `${base}/{${idParam}}`;
  const project = async (c: CompatCall) => {
    const id = pathId(c, "project_id");
    await loadRow(c.ctx, projectMapping, id);
    return id;
  };
  const child = async (c: CompatCall) => {
    const pid = await project(c);
    const rows = await selectRows(c.ctx, m, { where: ["id = ?", "project_id = ?"], args: [pathId(c, idParam), pid], limit: 1 });
    if (!rows[0]) throw notFound(m.label);
    return rows[0];
  };
  return [
    route("GET", base, async (c) => listWire(c, m, { where: ["project_id = ?"], args: [await project(c)] })),
    route("POST", base, async (c) => created(await createWire(c.ctx, m, bodyObject(c), { project_id: await project(c) }))),
    route("GET", item, async (c) => wire(c.ctx, m, await child(c))),
    route(edit, item, async (c) => updateWire(c.ctx, m, Number((await child(c)).id), bodyObject(c))),
    route("DELETE", item, async (c) => {
      await deleteWire(c.ctx, m, Number((await child(c)).id));
      return ok;
    }),
  ];
}

async function setArchived(ctx: Ctx, id: number, archived: boolean) {
  assertCan(ctx, "projects", "write");
  await loadRow(ctx, projectMapping, id);
  await patchColumns(ctx, { table: "projects" }, id, { archived_at: archived ? new Date().toISOString() : null });
  await audit(ctx, { action: archived ? "archive" : "restore", resource: "projects", resourceId: id, summary: archived ? "Archived project" : "Reactivated project" });
  return ok;
}

export function projectRoutes(): Route[] {
  return [
    ...crud("/2.0/pr_project", "project_id", projectMapping, ["list", "create", "search", "show", "edit", "delete"]),
    route("POST", "/2.0/pr_project/{project_id}/archive", (c) => setArchived(c.ctx, pathId(c, "project_id"), true)),
    route("POST", "/2.0/pr_project/{project_id}/reactivate", (c) => setArchived(c.ctx, pathId(c, "project_id"), false)),
    route("GET", "/2.0/pr_project_state", async () => PROJECT_STATE.rows()),
    route("GET", "/2.0/pr_project_type", async () => PROJECT_TYPE.rows()),
    ...crud("/2.0/timesheet", "timesheet_id", timesheetMapping, ["list", "create", "search", "show", "edit", "delete"]),
    route("GET", "/2.0/timesheet_status", async () => TIMESHEET_STATUS.rows()),
    ...projectChildren("milestones", "milestone_id", milestoneMapping, "POST"),
    ...projectChildren("packages", "package_id", packageMapping, "PATCH"),
  ];
}
