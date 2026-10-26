import { patchColumns } from "../../crud";
import { AppError } from "../../errors";
import { invoiceProjectTime } from "../../projects";
import { defineResource } from "../define";
import { f, opt } from "../fields";
import type { ResourceDef, Row } from "../types";

const PROJECT_STATUS = [
  opt("planned", "Planned", "muted"),
  opt("active", "Active", "info"),
  opt("on_hold", "On hold", "warning"),
  opt("completed", "Completed", "success"),
  opt("cancelled", "Cancelled", "muted"),
];

const minutesBetween = (start: string, end: string) => {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let diff = eh * 60 + em - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return diff;
};

export const projectResources: ResourceDef[] = [
  defineResource({
    name: "projects",
    singular: "project",
    label: "Project",
    labelPlural: "Projects",
    description: "Customer and internal projects with budgets, milestones, work packages and time tracking.",
    table: "projects",
    area: "projects",
    icon: "FolderKanban",
    nav: { group: "projects", order: 10 },
    numbering: { field: "nr", sequence: "project" },
    softDelete: true,
    statusField: "status",
    fields: [
      f.string("nr", "Number", { list: true, search: true, sortable: true, span: 2, format: "code" }),
      f.string("name", "Name", { required: true, list: true, search: true, sortable: true, span: 4, format: "strong" }),
      f.enum("status", "Status", PROJECT_STATUS, { default: "active", list: true, filter: true, span: 2 }),
      f.enum("type", "Type", [opt("customer", "Customer project"), opt("internal", "Internal")], { default: "customer", list: true, filter: true, span: 2 }),
      f.ref("contact_id", "Customer", "contacts", { list: true, filter: true, span: 2 }),
      f.ref("contact_person_id", "Contact person", "contacts", { refFilter: { type: "person" }, span: 3 }),
      f.string("responsible_user_id", "Project lead", { hidden: true }),
      f.date("start_date", "Start", { list: true, sortable: true, span: 2 }),
      f.date("end_date", "End", { list: true, span: 2 }),
      f.enum("budget_type", "Budget", [opt("none", "No budget"), opt("hours", "Hours"), opt("amount", "Amount")], { default: "none", span: 2, section: "Budget" }),
      f.decimal("budget_hours", "Budget hours", { span: 2 }),
      f.money("budget_amount", "Budget amount", { span: 2 }),
      f.decimal("hourly_rate", "Default hourly rate", { span: 2 }),
      f.text("description", "Description", { span: 6 }),
      f.datetime("archived_at", "Archived", { readOnly: true, hidden: true }),
    ],
    titleSql: "coalesce(nr || ' – ', '') || name",
    defaultSort: { field: "name", dir: "asc" },
    related: [
      { resource: "timesheets", foreignKey: "project_id", label: "Time" },
      { resource: "tasks", foreignKey: "project_id", label: "Tasks" },
      { resource: "project_milestones", foreignKey: "project_id", label: "Milestones" },
      { resource: "work_packages", foreignKey: "project_id", label: "Work packages" },
      { resource: "invoices", foreignKey: "project_id", label: "Invoices" },
      { resource: "bills", foreignKey: "project_id", label: "Costs" },
      { resource: "notes", foreignKey: "project_id", label: "Notes" },
    ],
    actions: [
      {
        name: "invoice_time",
        label: "Invoice unbilled time",
        description: "Creates a draft invoice from all unbilled billable time, grouped by activity and rate.",
        icon: "Receipt",
        available: (r: Row) => r.type === "customer" && !!r.contact_id,
        input: [f.date("until", "Up to date")],
        run: async (ctx, r, input) => {
          const invoice = await invoiceProjectTime(ctx, r, { until: (input.until as string) ?? null });
          return { message: "Invoice created.", redirect: { resource: "invoices", id: Number(invoice.id) } };
        },
      },
      {
        name: "complete",
        label: "Complete project",
        description: "Sets the project status to completed.",
        icon: "CheckCheck",
        variant: "outline",
        available: (r: Row) => r.status === "active" || r.status === "on_hold",
        run: async (ctx, r) => {
          await patchColumns(ctx, { table: "projects" }, Number(r.id), { status: "completed", end_date: r.end_date ?? new Date().toISOString().slice(0, 10) });
          return { message: "Project completed." };
        },
      },
    ],
  }),
  defineResource({
    name: "project_milestones",
    singular: "milestone",
    label: "Milestone",
    labelPlural: "Milestones",
    description: "Project milestones with due dates.",
    table: "project_milestones",
    area: "projects",
    icon: "Flag",
    nav: false,
    fields: [
      f.ref("project_id", "Project", "projects", { required: true, list: true, filter: true, span: 3 }),
      f.string("name", "Name", { required: true, list: true, search: true, span: 3 }),
      f.date("due_date", "Due", { list: true, sortable: true, span: 2 }),
      f.boolean("is_done", "Done", { list: true, filter: true, span: 1 }),
      f.text("description", "Description", { span: 6 }),
    ],
    titleSql: "name",
    defaultSort: { field: "due_date", dir: "asc" },
  }),
  defineResource({
    name: "work_packages",
    singular: "work_package",
    label: "Work package",
    labelPlural: "Work packages",
    description: "Work packages with time estimates, optionally linked to a milestone.",
    table: "work_packages",
    area: "projects",
    icon: "Boxes",
    nav: false,
    fields: [
      f.ref("project_id", "Project", "projects", { required: true, list: true, filter: true, span: 3 }),
      f.string("name", "Name", { required: true, list: true, search: true, span: 3 }),
      f.ref("milestone_id", "Milestone", "project_milestones", { list: true, span: 3 }),
      f.decimal("estimated_hours", "Estimate (h)", { list: true, span: 2 }),
      f.boolean("is_done", "Done", { list: true, span: 1 }),
      f.text("description", "Description", { span: 6 }),
    ],
    titleSql: "name",
    defaultSort: { field: "id", dir: "asc" },
  }),
  defineResource({
    name: "business_activities",
    singular: "business_activity",
    label: "Activity",
    labelPlural: "Activities",
    description: "Billable activities (consulting, development…) with default hourly rates.",
    table: "business_activities",
    area: "projects",
    icon: "Hammer",
    nav: { group: "projects", order: 40 },
    fields: [
      f.string("name", "Name", { required: true, list: true, search: true, span: 3 }),
      f.decimal("hourly_rate", "Hourly rate", { list: true, span: 1 }),
      f.boolean("is_billable", "Billable", { default: true, list: true, span: 1 }),
      f.ref("account_id", "Revenue account", "accounts", { refFilter: { type: "revenue" }, span: 3 }),
    ],
    titleSql: "name",
    defaultSort: { field: "name", dir: "asc" },
  }),
  defineResource({
    name: "timesheets",
    singular: "timesheet",
    label: "Time entry",
    labelPlural: "Time tracking",
    description: "Time entries on projects and activities; unbilled billable time can be invoiced.",
    table: "timesheets",
    area: "projects",
    icon: "Timer",
    nav: { group: "projects", order: 20 },
    statusField: "status",
    fields: [
      f.date("date", "Date", { required: true, list: true, sortable: true, filter: true, default: "$today", span: 2 }),
      f.time("start_time", "From", { span: 1 }),
      f.time("end_time", "To", { span: 1 }),
      f.int("duration_minutes", "Duration (min)", { list: true, sortable: true, span: 2, format: "duration", min: 0 }),
      f.ref("project_id", "Project", "projects", { list: true, filter: true, span: 3 }),
      f.ref("work_package_id", "Work package", "work_packages", { span: 3 }),
      f.ref("activity_id", "Activity", "business_activities", { list: true, filter: true, span: 3 }),
      f.ref("contact_id", "Customer", "contacts", { filter: true, span: 3 }),
      f.string("user_name", "Person", { list: true, search: true, filter: true, span: 3 }),
      f.string("user_id", "User", { hidden: true, filter: true }),
      f.text("description", "Description", { list: true, search: true, span: 6 }),
      f.boolean("is_billable", "Billable", { default: true, list: true, filter: true, span: 1 }),
      f.decimal("hourly_rate", "Rate override", { span: 2 }),
      f.enum("status", "Status", [opt("open", "Open", "info"), opt("approved", "Approved", "primary"), opt("billed", "Billed", "success")], {
        default: "open",
        list: true,
        filter: true,
        span: 2,
      }),
      f.ref("document_id", "Invoice", "invoices", { readOnly: true, list: false }),
    ],
    titleSql: "date || ' ' || coalesce(description, '')",
    defaultSort: { field: "date", dir: "desc" },
    hooks: {
      prepare: async (ctx, data, existing) => {
        const start = (data.start_time ?? existing?.start_time) as string | null;
        const end = (data.end_time ?? existing?.end_time) as string | null;
        if (start && end && (data.start_time !== undefined || data.end_time !== undefined) && !data.duration_minutes) {
          data.duration_minutes = minutesBetween(start, end);
        }
        if (!existing) {
          data.user_name ??= ctx.actor.name;
          data.user_id ??= ctx.user?.id ?? null;
          if (data.project_id && !data.contact_id) {
            data.contact_id = await ctx.db.value<number>("SELECT contact_id FROM projects WHERE id = ?", data.project_id);
          }
        }
        const minutes = Number(data.duration_minutes ?? existing?.duration_minutes ?? 0);
        if (!minutes) throw new AppError("validation", "Enter a duration or start and end time.", { duration_minutes: "Required" });
        return data;
      },
      lockReason: (r) => (r.status === "billed" ? "Billed time can no longer be edited." : null),
    },
  }),
  defineResource({
    name: "tasks",
    singular: "task",
    label: "Task",
    labelPlural: "Tasks",
    description: "To-dos with priority and due date, linked to contacts or projects.",
    table: "tasks",
    area: "projects",
    icon: "ListTodo",
    nav: { group: "projects", order: 30 },
    statusField: "status",
    fields: [
      f.string("subject", "Subject", { required: true, list: true, search: true, span: 4, format: "strong" }),
      f.enum(
        "status",
        "Status",
        [opt("todo", "To do", "info"), opt("in_progress", "In progress", "primary"), opt("done", "Done", "success"), opt("cancelled", "Cancelled", "muted")],
        { default: "todo", list: true, filter: true, span: 2 },
      ),
      f.enum(
        "priority",
        "Priority",
        [opt("low", "Low", "muted"), opt("normal", "Normal", "neutral"), opt("high", "High", "warning"), opt("urgent", "Urgent", "danger")],
        { default: "normal", list: true, filter: true, span: 2 },
      ),
      f.date("due_date", "Due", { list: true, sortable: true, filter: true, span: 2 }),
      f.string("assignee_name", "Assignee", { list: true, search: true, span: 2 }),
      f.string("assignee_user_id", "Assignee user", { hidden: true, filter: true }),
      f.ref("contact_id", "Contact", "contacts", { list: true, filter: true, span: 3 }),
      f.ref("project_id", "Project", "projects", { list: true, filter: true, span: 3 }),
      f.text("description", "Description", { search: true, span: 6 }),
      f.datetime("done_at", "Completed", { readOnly: true, hidden: true }),
    ],
    titleSql: "subject",
    defaultSort: { field: "due_date", dir: "asc" },
    hooks: {
      prepare: (_ctx, data, existing) => {
        if (data.status === "done" && existing?.status !== "done") data.done_at = new Date().toISOString();
        if (data.status && data.status !== "done") data.done_at = null;
        return data;
      },
    },
    actions: [
      {
        name: "complete",
        label: "Mark as done",
        description: "Completes the task.",
        icon: "CheckCheck",
        available: (r) => r.status !== "done",
        run: async (ctx, r) => {
          await patchColumns(ctx, { table: "tasks" }, Number(r.id), { status: "done", done_at: new Date().toISOString() });
          return { message: "Task completed." };
        },
      },
    ],
  }),
];
