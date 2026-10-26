import { formatAmount } from "@batzio/core/format";
import { today } from "@batzio/core/format";
import {
  assertPeriodOpen,
  closeBusinessYear,
  rebuildPostings,
  reverseEntry,
  settleVat,
  validateLines,
  type EntryLineInput,
} from "../../accounting";
import { patchColumns } from "../../crud";
import { AppError } from "../../errors";
import { defineResource } from "../define";
import { f, opt } from "../fields";
import type { ResourceDef, Row } from "../types";

const ACCOUNT_TYPES = [
  opt("asset", "Asset", "info"),
  opt("liability", "Liability", "warning"),
  opt("equity", "Equity", "primary"),
  opt("revenue", "Revenue", "success"),
  opt("expense", "Expense", "danger"),
];

export const ENTRY_TYPES = [
  opt("manual", "Manual", "neutral"),
  opt("invoice", "Invoice", "info"),
  opt("credit_note", "Credit note", "info"),
  opt("payment", "Payment", "success"),
  opt("bill", "Supplier bill", "warning"),
  opt("bill_payment", "Supplier payment", "warning"),
  opt("expense", "Expense", "warning"),
  opt("bank", "Bank", "primary"),
  opt("payroll", "Payroll", "primary"),
  opt("vat_settlement", "VAT settlement", "muted"),
  opt("opening", "Opening", "muted"),
  opt("closing", "Closing", "muted"),
  opt("reversal", "Reversal", "danger"),
];

export const accountingResources: ResourceDef[] = [
  defineResource({
    name: "accounts",
    singular: "account",
    label: "Account",
    labelPlural: "Chart of accounts",
    description: "Ledger accounts following the Swiss SME chart of accounts (KMU).",
    table: "accounts",
    area: "accounting",
    icon: "BookOpen",
    nav: { group: "accounting", order: 10 },
    fields: [
      f.string("number", "Number", { required: true, list: true, search: true, sortable: true, span: 1, format: "code" }),
      f.string("name", "Name", { required: true, list: true, search: true, sortable: true, span: 4, format: "strong" }),
      f.enum("type", "Type", ACCOUNT_TYPES, { required: true, list: true, filter: true, span: 1 }),
      f.ref("group_id", "Group", "account_groups", { list: true, filter: true, span: 3 }),
      f.ref("default_tax_id", "Default VAT", "taxes", { span: 3 }),
      f.string("currency_code", "Currency (foreign currency account)", { maxLength: 3, span: 2 }),
      f.boolean("is_active", "Active", { default: true, filter: true, list: true, span: 1 }),
      f.boolean("is_system", "System account", { readOnly: true, list: false }),
      f.text("description", "Description", { span: 6 }),
    ],
    titleSql: "number || ' ' || name",
    defaultSort: { field: "number", dir: "asc" },
    hooks: {
      beforeDelete: async (ctx, r) => {
        if (r.is_system) throw new AppError("locked", "System accounts are used by automatic bookings and cannot be deleted.");
        const used = await ctx.db.value<number>("SELECT COUNT(*) FROM postings WHERE account_id = ?", r.id);
        if (used) throw new AppError("locked", "This account has bookings. Deactivate it instead.");
      },
    },
  }),
  defineResource({
    name: "account_groups",
    singular: "account_group",
    label: "Account group",
    labelPlural: "Account groups",
    description: "Hierarchy of account classes and groups used in financial statements.",
    table: "account_groups",
    area: "accounting",
    icon: "FolderTree",
    nav: false,
    fields: [
      f.string("number", "Number", { required: true, list: true, sortable: true, span: 1, format: "code" }),
      f.string("name", "Name", { required: true, list: true, search: true, span: 4 }),
      f.enum("type", "Type", ACCOUNT_TYPES, { required: true, list: true, filter: true, span: 1 }),
      f.ref("parent_id", "Parent", "account_groups", { list: true, span: 3 }),
      f.int("sort", "Sort", { span: 1 }),
    ],
    titleSql: "number || ' ' || name",
    defaultSort: { field: "number", dir: "asc" },
  }),
  defineResource({
    name: "taxes",
    singular: "tax",
    label: "VAT code",
    labelPlural: "VAT codes",
    description: "Swiss VAT codes (8.1%, 2.6%, 3.8%, exempt) with booking accounts and VAT form digits.",
    table: "taxes",
    area: "accounting",
    icon: "Percent",
    nav: { group: "accounting", order: 60 },
    fields: [
      f.string("code", "Code", { required: true, list: true, search: true, sortable: true, span: 1, format: "code" }),
      f.string("name", "Name", { required: true, list: true, search: true, span: 3 }),
      f.percent("rate", "Rate %", { required: true, list: true, span: 1 }),
      f.enum("type", "Type", [opt("sales", "Sales VAT", "success"), opt("purchase", "Input VAT", "warning")], { required: true, list: true, filter: true, span: 1 }),
      f.enum(
        "category",
        "Category",
        [
          opt("standard", "Standard"),
          opt("reduced", "Reduced"),
          opt("accommodation", "Accommodation"),
          opt("zero", "Zero-rated / export"),
          opt("exempt", "Exempt"),
          opt("investment", "Investments / operating"),
        ],
        { default: "standard", list: true, span: 2 },
      ),
      f.ref("account_id", "VAT account", "accounts", { list: true, span: 2 }),
      f.string("vat_form_digit", "VAT form digit", { list: true, span: 1 }),
      f.date("valid_from", "Valid from", { span: 1 }),
      f.date("valid_to", "Valid to", { span: 1 }),
      f.boolean("is_active", "Active", { default: true, list: true, filter: true, span: 1 }),
    ],
    titleSql: "code || ' (' || rate || '%)'",
    defaultSort: { field: "code", dir: "asc" },
    hooks: {
      beforeDelete: async (ctx, r) => {
        const used = await ctx.db.value<number>("SELECT COUNT(*) FROM postings WHERE tax_id = ?", r.id);
        if (used) throw new AppError("locked", "This VAT code has bookings. Deactivate it instead.");
      },
    },
  }),
  defineResource({
    name: "journal_entries",
    singular: "journal_entry",
    label: "Journal entry",
    labelPlural: "Journal",
    description: "Double-entry bookings. Lines with a VAT code split VAT automatically.",
    table: "journal_entries",
    area: "accounting",
    icon: "NotebookPen",
    nav: { group: "accounting", order: 20 },
    numbering: { field: "ref_nr", sequence: "journal" },
    view: "entry",
    fields: [
      f.string("ref_nr", "Reference", { list: true, search: true, sortable: true, span: 2, format: "code" }),
      f.date("date", "Date", { required: true, list: true, sortable: true, filter: true, default: "$today", span: 2 }),
      f.string("description", "Description", { required: true, list: true, search: true, span: 6, format: "strong" }),
      f.enum("type", "Type", ENTRY_TYPES, { readOnly: true, list: true, filter: true, default: "manual" }),
      f.money("total", "Amount", { readOnly: true, list: true, sortable: true }),
      f.string("currency_code", "Currency", { readOnly: true, hidden: true }),
      f.string("source_type", "Source", { readOnly: true, hidden: true, filter: true }),
      f.int("source_id", "Source ID", { readOnly: true, hidden: true, filter: true }),
      f.boolean("is_locked", "Locked", { readOnly: true, list: true, filter: true }),
      f.int("reversal_of_id", "Reversal of", { readOnly: true, hidden: true }),
      f.ref("file_id", "Receipt", "files", { span: 3 }),
    ],
    children: [
      {
        name: "lines",
        label: "Lines",
        table: "journal_lines",
        foreignKey: "entry_id",
        orderBy: "sort",
        fields: [
          f.int("id", "ID", { readOnly: true, hidden: true }),
          f.int("sort", "Sort", { hidden: true }),
          f.ref("debit_account_id", "Debit", "accounts", { required: true }),
          f.ref("credit_account_id", "Credit", "accounts", { required: true }),
          f.money("amount", "Amount", { required: true, description: "Gross amount (incl. VAT when a VAT code is set)" }),
          f.ref("tax_id", "VAT", "taxes"),
          f.money("vat_amount", "VAT amount", { readOnly: true }),
          f.string("description", "Text"),
          f.ref("contact_id", "Contact", "contacts"),
        ],
      },
    ],
    titleSql: "coalesce(ref_nr, '#' || id) || ' ' || description",
    defaultSort: { field: "date", dir: "desc" },
    hooks: {
      prepare: async (ctx, data, existing) => {
        const lines = (data.lines as EntryLineInput[] | undefined) ?? (existing?.lines as EntryLineInput[] | undefined) ?? [];
        await validateLines(ctx, lines, String(data.date ?? existing?.date ?? today()));
        return { ...data, total: lines.reduce((s, l) => s + Number(l.amount), 0) };
      },
      afterWrite: async (ctx, record) => {
        await rebuildPostings(ctx, Number(record.id));
      },
      lockReason: (r) =>
        r.is_locked ? "This entry is locked (automatic booking or closed period). Book a reversal or correct the source document." : null,
      beforeDelete: async (ctx, r) => {
        if (r.is_locked) throw new AppError("locked", "Locked entries cannot be deleted. Book a reversal instead.");
        await assertPeriodOpen(ctx, String(r.date));
      },
    },
    actions: [
      {
        name: "reverse",
        label: "Book reversal",
        description: "Books a mirror-image entry that cancels this one.",
        icon: "Undo2",
        variant: "outline",
        available: (r: Row) => r.type !== "reversal",
        input: [f.date("date", "Reversal date", { required: true, default: "$today" })],
        run: async (ctx, r, input) => {
          const id = await reverseEntry(ctx, Number(r.id), String(input.date ?? today()));
          return { message: "Reversal booked.", redirect: { resource: "journal_entries", id } };
        },
      },
    ],
  }),
  defineResource(
    {
      name: "postings",
      singular: "posting",
      label: "Posting",
      labelPlural: "Postings",
      description: "Individual debit/credit postings per account (derived from journal entries).",
      table: "postings",
      area: "accounting",
      icon: "Rows3",
      nav: false,
      readOnly: true,
      fields: [
        f.int("entry_id", "Entry", { list: true, filter: true }),
        f.date("date", "Date", { list: true, sortable: true, filter: true }),
        f.ref("account_id", "Account", "accounts", { list: true, filter: true }),
        f.money("debit", "Debit", { list: true }),
        f.money("credit", "Credit", { list: true }),
        f.ref("tax_id", "VAT", "taxes", { list: true, filter: true }),
        f.enum("tax_role", "VAT role", [opt("base", "Taxable base"), opt("tax", "Tax")], { list: true, filter: true }),
        f.string("description", "Text", { list: true, search: true }),
        f.ref("contra_account_id", "Contra account", "accounts", { list: true }),
        f.int("line_id", "Line", { hidden: true }),
      ],
      titleSql: "date || ' #' || id",
      defaultSort: { field: "date", dir: "desc" },
    },
    { stamps: false },
  ),
  defineResource({
    name: "business_years",
    singular: "business_year",
    label: "Business year",
    labelPlural: "Business years",
    description: "Financial years; closing books the result and locks the period.",
    table: "business_years",
    area: "accounting",
    icon: "CalendarRange",
    nav: { group: "accounting", order: 70 },
    statusField: "status",
    fields: [
      f.string("name", "Name", { required: true, list: true, search: true, span: 2 }),
      f.date("start_date", "Start", { required: true, list: true, sortable: true, span: 2 }),
      f.date("end_date", "End", { required: true, list: true, span: 2 }),
      f.enum("status", "Status", [opt("open", "Open", "info"), opt("closed", "Closed", "muted")], { readOnly: true, list: true, default: "open" }),
      f.datetime("closed_at", "Closed at", { readOnly: true, list: true }),
      f.int("closing_entry_id", "Closing entry", { readOnly: true, hidden: true }),
    ],
    titleSql: "name",
    defaultSort: { field: "start_date", dir: "desc" },
    hooks: {
      lockReason: (r) => (r.status === "closed" ? "Closed business years cannot be edited." : null),
      prepare: (_ctx, data, existing) => {
        const start = String(data.start_date ?? existing?.start_date);
        const end = String(data.end_date ?? existing?.end_date);
        if (end <= start) throw new AppError("validation", "The end must be after the start.", { end_date: "Must be after start" });
        return data;
      },
    },
    actions: [
      {
        name: "close",
        label: "Close year",
        description: "Books the profit or loss to equity and locks all entries of the year.",
        icon: "Lock",
        confirm: "Close this business year? All bookings in it will be locked.",
        available: (r) => r.status === "open",
        run: async (ctx, r) => {
          const { profit } = await closeBusinessYear(ctx, Number(r.id));
          return { message: "Year closed with a result of {amount}.", vars: { amount: formatAmount(profit) } };
        },
      },
      {
        name: "reopen",
        label: "Reopen year",
        description: "Reverses the closing entry and unlocks manual entries of the year.",
        icon: "LockOpen",
        variant: "outline",
        confirm: "Reopen this business year?",
        available: (r) => r.status === "closed",
        run: async (ctx, r) => {
          if (r.closing_entry_id) {
            await ctx.db.run("DELETE FROM journal_entries WHERE id = ?", r.closing_entry_id);
          }
          await ctx.db.run(
            "UPDATE journal_entries SET is_locked = 0 WHERE date BETWEEN ? AND ? AND type = 'manual'",
            r.start_date,
            r.end_date,
          );
          await patchColumns(ctx, { table: "business_years" }, Number(r.id), { status: "open", closed_at: null, closing_entry_id: null });
          return { message: "Business year reopened." };
        },
      },
    ],
  }),
  defineResource({
    name: "vat_periods",
    singular: "vat_period",
    label: "VAT period",
    labelPlural: "VAT periods",
    description: "VAT reporting periods with settlement booking and submission status.",
    table: "vat_periods",
    area: "accounting",
    icon: "CalendarCheck",
    nav: { group: "accounting", order: 80 },
    statusField: "status",
    fields: [
      f.string("name", "Name", { required: true, list: true, search: true, span: 2 }),
      f.date("start_date", "Start", { required: true, list: true, sortable: true, span: 2 }),
      f.date("end_date", "End", { required: true, list: true, span: 2 }),
      f.enum("method", "Method", [opt("effective", "Effective method"), opt("net_tax_rate", "Net tax rate")], { default: "effective", list: true, span: 2 }),
      f.enum("status", "Status", [opt("open", "Open", "info"), opt("submitted", "Submitted", "success"), opt("closed", "Closed", "muted")], { readOnly: true, list: true, default: "open" }),
      f.datetime("submitted_at", "Submitted", { readOnly: true, list: true }),
      f.int("settlement_entry_id", "Settlement entry", { readOnly: true, hidden: true }),
    ],
    titleSql: "name",
    defaultSort: { field: "start_date", dir: "desc" },
    actions: [
      {
        name: "settle",
        label: "Book VAT settlement",
        description: "Transfers the VAT balances of the period to the VAT settlement account (2201).",
        icon: "Scale",
        available: (r) => r.status === "open" && !r.settlement_entry_id,
        run: async (ctx, r) => {
          const id = await settleVat(ctx, String(r.start_date), String(r.end_date));
          await patchColumns(ctx, { table: "vat_periods" }, Number(r.id), { settlement_entry_id: id });
          return { message: id ? "VAT settlement booked." : "Nothing to settle in this period." };
        },
      },
      {
        name: "submit",
        label: "Mark as submitted",
        description: "Records that the VAT return was filed with the tax authority.",
        icon: "Send",
        variant: "outline",
        available: (r) => r.status === "open",
        run: async (ctx, r) => {
          await patchColumns(ctx, { table: "vat_periods" }, Number(r.id), { status: "submitted", submitted_at: new Date().toISOString() });
          return { message: "VAT period marked as submitted." };
        },
      },
    ],
  }),
];
