import { AppError } from "../../errors";
import { finalizePayslip, preparePayslip, revertPayslip } from "../../payroll";
import { isValidAhvNumber } from "@batzio/core/swiss/identifiers";
import { defineResource } from "../define";
import { f, opt } from "../fields";
import type { ResourceDef } from "../types";

export const payrollResources: ResourceDef[] = [
  defineResource({
    name: "employees",
    singular: "employee",
    label: "Employee",
    labelPlural: "Employees",
    description: "Employees with salary, workload and Swiss social insurance parameters.",
    table: "employees",
    area: "payroll",
    icon: "IdCard",
    nav: { group: "payroll", order: 10 },
    numbering: { field: "nr", sequence: "employee" },
    fields: [
      f.string("nr", "Number", { list: true, search: true, sortable: true, span: 2, format: "code", section: "Person" }),
      f.string("firstname", "First name", { required: true, list: true, search: true, span: 2 }),
      f.string("lastname", "Last name", { required: true, list: true, search: true, sortable: true, span: 2, format: "strong" }),
      f.email("email", "Email", { list: true, span: 3 }),
      f.phone("phone", "Phone", { span: 3 }),
      f.date("birthday", "Date of birth", { span: 2 }),
      f.string("ahv_number", "AHV number", { span: 2, placeholder: "756.1234.5678.97" }),
      f.string("job_title", "Job title", { list: true, span: 2 }),
      f.string("street", "Street", { span: 4, section: "Address" }),
      f.string("house_number", "No.", { span: 2 }),
      f.string("postcode", "Postcode", { span: 2 }),
      f.string("city", "City", { span: 2 }),
      f.string("country_code", "Country", { default: "CH", maxLength: 2, span: 2 }),
      f.iban("iban", "Salary IBAN", { span: 3 }),
      f.date("entry_date", "Entry date", { list: true, span: 2, section: "Employment" }),
      f.date("exit_date", "Exit date", { span: 2 }),
      f.percent("workload_percent", "Workload %", { default: 100, list: true, span: 2 }),
      f.enum("salary_type", "Salary type", [opt("monthly", "Monthly salary"), opt("hourly", "Hourly wage")], { default: "monthly", span: 2 }),
      f.money("monthly_salary", "Monthly gross salary", { list: true, span: 2 }),
      f.decimal("hourly_rate", "Hourly wage", { span: 2 }),
      f.boolean("thirteenth_salary", "13th salary (paid in December)", { default: true, span: 3 }),
      f.percent("bvg_rate", "BVG employee %", { default: 0, span: 2, section: "Insurance" }),
      f.percent("nbu_rate", "NBU employee %", { default: 0, span: 2 }),
      f.percent("ktg_rate", "KTG employee %", { default: 0, span: 2 }),
      f.percent("withholding_tax_rate", "Withholding tax %", { default: 0, span: 2 }),
      f.money("child_allowance", "Family allowances / month", { default: 0, span: 2 }),
      f.decimal("vacation_days", "Vacation days / year", { default: 25, span: 2 }),
      f.boolean("is_active", "Active", { default: true, list: true, filter: true, span: 1 }),
      f.text("notes", "Notes", { span: 6 }),
    ],
    titleSql: "firstname || ' ' || lastname",
    defaultSort: { field: "lastname", dir: "asc" },
    related: [
      { resource: "payslips", foreignKey: "employee_id", label: "Payslips" },
      { resource: "absences", foreignKey: "employee_id", label: "Absences" },
    ],
    hooks: {
      prepare: (_ctx, data) => {
        if (data.ahv_number && !isValidAhvNumber(String(data.ahv_number))) {
          throw new AppError("validation", "The AHV number is not valid.", { ahv_number: "Invalid check digit" });
        }
        return data;
      },
    },
  }),
  defineResource({
    name: "absences",
    singular: "absence",
    label: "Absence",
    labelPlural: "Absences",
    description: "Vacation, sickness, accident, military service and other absences.",
    table: "absences",
    area: "payroll",
    icon: "CalendarOff",
    nav: { group: "payroll", order: 30 },
    statusField: "status",
    fields: [
      f.ref("employee_id", "Employee", "employees", { required: true, list: true, filter: true, span: 3 }),
      f.enum(
        "type",
        "Type",
        [
          opt("vacation", "Vacation", "info"),
          opt("sick", "Sickness", "warning"),
          opt("accident", "Accident", "danger"),
          opt("military", "Military / civil service", "primary"),
          opt("maternity", "Maternity leave", "primary"),
          opt("paternity", "Paternity leave", "primary"),
          opt("training", "Training", "neutral"),
          opt("other", "Other", "muted"),
        ],
        { default: "vacation", list: true, filter: true, span: 3 },
      ),
      f.date("start_date", "From", { required: true, list: true, sortable: true, span: 2 }),
      f.date("end_date", "To", { required: true, list: true, span: 2 }),
      f.decimal("days", "Days", { default: 1, list: true, span: 2 }),
      f.enum("status", "Status", [opt("requested", "Requested", "warning"), opt("approved", "Approved", "success"), opt("rejected", "Rejected", "danger")], {
        default: "approved",
        list: true,
        filter: true,
        span: 2,
      }),
      f.text("note", "Note", { span: 6 }),
    ],
    titleSql: "type || ' ' || start_date",
    defaultSort: { field: "start_date", dir: "desc" },
  }),
  defineResource({
    name: "payslips",
    singular: "payslip",
    label: "Payslip",
    labelPlural: "Payslips",
    description: "Monthly payslips with AHV/IV/EO, ALV, BVG, NBU, KTG and withholding tax.",
    table: "payslips",
    area: "payroll",
    icon: "Banknote",
    nav: { group: "payroll", order: 20 },
    statusField: "status",
    fields: [
      f.ref("employee_id", "Employee", "employees", { required: true, list: true, filter: true, createOnly: true, span: 3 }),
      f.int("year", "Year", { required: true, list: true, filter: true, sortable: true, createOnly: true, span: 1 }),
      f.int("month", "Month", { required: true, list: true, filter: true, sortable: true, createOnly: true, min: 1, max: 12, span: 1 }),
      f.money("gross", "Gross salary", { list: true, span: 2 }),
      f.money("ahv", "AHV/IV/EO", { readOnly: true }),
      f.money("alv", "ALV", { readOnly: true }),
      f.money("bvg", "BVG", { readOnly: true }),
      f.money("nbu", "NBU", { readOnly: true }),
      f.money("ktg", "KTG", { readOnly: true }),
      f.money("withholding_tax", "Withholding tax", { readOnly: true }),
      f.money("allowances", "Allowances", { readOnly: true }),
      f.money("net", "Net salary", { readOnly: true, list: true }),
      f.money("employer_cost", "Employer cost", { readOnly: true, list: true }),
      f.json("details", "Details", { readOnly: true, hidden: true }),
      f.enum("status", "Status", [opt("draft", "Draft", "muted"), opt("final", "Final", "success")], { readOnly: true, list: true, filter: true, default: "draft" }),
      f.int("journal_entry_id", "Journal entry", { readOnly: true, hidden: true }),
    ],
    titleSql: "printf('%02d/%d', month, year)",
    defaultSort: { field: "year", dir: "desc" },
    hooks: {
      prepare: preparePayslip,
      lockReason: (r) => (r.status === "draft" ? null : "Final payslips cannot be edited. Revert the payslip first."),
      beforeDelete: async (_ctx, r) => {
        if (r.status !== "draft") throw new AppError("locked", "Only draft payslips can be deleted.");
      },
    },
    actions: [
      {
        name: "finalize",
        label: "Finalise & book",
        description: "Finalises the payslip and books salary, deductions and employer contributions.",
        icon: "Stamp",
        available: (r) => r.status === "draft",
        run: async (ctx, r) => {
          await finalizePayslip(ctx, r);
          return { message: "Payslip finalised and booked." };
        },
      },
      {
        name: "revert",
        label: "Revert to draft",
        description: "Reverses the booking.",
        icon: "Undo2",
        variant: "outline",
        available: (r) => r.status === "final",
        run: async (ctx, r) => {
          await revertPayslip(ctx, r);
          return { message: "Payslip reverted." };
        },
      },
    ],
  }),
];
