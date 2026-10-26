import { today } from "@batzio/core/format";
import type { Ctx } from "../../ctx";
import { AppError } from "../../errors";
import {
  billLockReason,
  bookBill,
  bookExpense,
  cancelBill,
  cancelOutgoing,
  markOutgoingPaid,
  payBill,
  prepareBill,
  prepareExpense,
  revertBill,
  revertExpense,
  schedulePayment,
} from "../../purchases";
import { defineResource } from "../define";
import { CURRENCY_OPTIONS, f, opt } from "../fields";
import type { ResourceDef, Row } from "../types";

const is = (...s: string[]) => (r: Row) => s.includes(String(r.status));


/** A bill or receipt made from a dropped/emailed file: attach the original and clear its inbox item. */
async function linkSourceFile(ctx: Ctx, resource: string, record: Row) {
  if (!record.file_id) return;
  await ctx.db.batch([
    { sql: "UPDATE files SET ref_type = ?, ref_id = ? WHERE id = ? AND (ref_id IS NULL OR ref_type = ?)", params: [resource, record.id, record.file_id, resource] },
    { sql: "UPDATE inbox_items SET status = 'done', updated_at = ? WHERE file_id = ? AND status IN ('new','needs_you','failed')", params: [new Date().toISOString(), record.file_id] },
  ]);
}

export const purchaseResources: ResourceDef[] = [
  defineResource({
    name: "bills",
    singular: "bill",
    label: "Supplier bill",
    labelPlural: "Supplier bills",
    description: "Incoming supplier invoices: booking with input VAT, payment scheduling and pain.001 export.",
    table: "bills",
    area: "purchases",
    icon: "FileInput",
    nav: { group: "purchases", order: 10 },
    numbering: { field: "nr", sequence: "bill" },
    view: "bill",
    statusField: "status",
    fields: [
      f.string("nr", "Number", { list: true, search: true, sortable: true, span: 2, format: "code", section: "Bill" }),
      f.string("vendor_nr", "Supplier invoice no.", { list: true, search: true, span: 2 }),
      f.enum(
        "status",
        "Status",
        [
          opt("draft", "Draft", "muted"),
          opt("booked", "Booked", "info"),
          opt("partial", "Partially paid", "warning"),
          opt("paid", "Paid", "success"),
          opt("cancelled", "Cancelled", "muted"),
        ],
        { readOnly: true, list: true, filter: true, default: "draft" },
      ),
      f.ref("contact_id", "Supplier", "contacts", { list: true, filter: true, refFilter: { is_supplier: true }, span: 3 }),
      f.string("title", "Title", { list: true, search: true, span: 3 }),
      f.date("date", "Bill date", { list: true, sortable: true, filter: true, default: "$today", span: 2 }),
      f.date("due_date", "Due date", { list: true, sortable: true, filter: true, span: 2 }),
      f.enum("currency_code", "Currency", CURRENCY_OPTIONS, { default: "CHF", span: 1 }),
      f.decimal("exchange_rate", "Rate", { default: 1, span: 1 }),
      f.enum("vat_mode", "Amounts", [opt("incl", "incl. VAT"), opt("excl", "excl. VAT")], { default: "incl", span: 2 }),
      f.ref("project_id", "Project", "projects", { filter: true, span: 2 }),
      f.iban("iban", "Pay to IBAN", { span: 3, section: "Payment" }),
      f.string("qr_reference", "QR / creditor reference", { span: 3 }),
      f.string("payment_message", "Payment message", { span: 6 }),
      f.ref("file_id", "Scanned bill", "files", { span: 3 }),
      f.text("notes", "Notes", { span: 6 }),
      f.money("total_net", "Net", { readOnly: true }),
      f.money("total_vat", "VAT", { readOnly: true }),
      f.money("total", "Total", { readOnly: true, list: true, sortable: true }),
      f.money("amount_paid", "Paid", { readOnly: true }),
      f.money("amount_open", "Open", { readOnly: true, list: true, sortable: true }),
      f.int("journal_entry_id", "Journal entry", { readOnly: true, hidden: true }),
      f.datetime("booked_at", "Booked", { readOnly: true, hidden: true }),
    ],
    children: [
      {
        name: "lines",
        label: "Lines",
        table: "bill_lines",
        foreignKey: "bill_id",
        orderBy: "sort",
        fields: [
          f.int("id", "ID", { readOnly: true, hidden: true }),
          f.int("sort", "Sort", { hidden: true }),
          f.string("text", "Description"),
          f.money("amount", "Amount", { required: true }),
          f.ref("tax_id", "Input VAT", "taxes", { refFilter: { type: "purchase" } }),
          f.decimal("tax_rate", "VAT rate", { readOnly: true }),
          f.ref("account_id", "Expense account", "accounts"),
        ],
      },
    ],
    titleSql: "coalesce(nr, '#' || id) || coalesce(' – ' || title, '')",
    defaultSort: { field: "date", dir: "desc" },
    related: [{ resource: "outgoing_payments", foreignKey: "bill_id", label: "Payments" }],
    hooks: {
      prepare: prepareBill,
      afterWrite: (ctx, record) => linkSourceFile(ctx, "bills", record),
      lockReason: billLockReason,
      beforeDelete: async (_ctx, r) => {
        if (r.status !== "draft") throw new AppError("locked", "Only draft bills can be deleted.");
      },
    },
    actions: [
      {
        name: "book",
        label: "Book",
        description: "Books the bill: expense and input VAT against payables.",
        icon: "Stamp",
        available: is("draft"),
        run: async (ctx, r) => {
          await bookBill(ctx, r);
          return { message: "Bill booked." };
        },
      },
      {
        name: "schedule_payment",
        label: "Schedule payment",
        description: "Creates a payment order to be exported to e-banking (pain.001).",
        icon: "CalendarClock",
        variant: "outline",
        available: is("booked", "partial"),
        input: [
          f.date("execution_date", "Execution date"),
          f.money("amount", "Amount", { description: "Defaults to the open amount" }),
          f.ref("bank_account_id", "From bank account", "bank_accounts"),
        ],
        run: async (ctx, r, input) => {
          const id = await schedulePayment(ctx, r, {
            execution_date: (input.execution_date as string) ?? null,
            amount: (input.amount as number) ?? null,
            bank_account_id: (input.bank_account_id as number) ?? null,
          });
          return { message: "Payment scheduled.", redirect: { resource: "outgoing_payments", id } };
        },
      },
      {
        name: "record_payment",
        label: "Record payment",
        description: "Records a payment that was already executed.",
        icon: "BadgeDollarSign",
        variant: "outline",
        available: is("booked", "partial"),
        input: [
          f.date("date", "Payment date", { required: true, default: "$today" }),
          f.money("amount", "Amount"),
          f.ref("bank_account_id", "Bank account", "bank_accounts"),
        ],
        run: async (ctx, r, input) => {
          await payBill(ctx, r, {
            date: String(input.date ?? today()),
            amount: (input.amount as number) ?? null,
            bank_account_id: (input.bank_account_id as number) ?? null,
          });
          return { message: "Payment recorded." };
        },
      },
      {
        name: "revert_to_draft",
        label: "Revert to draft",
        description: "Reverses the booking so the bill can be edited.",
        icon: "Undo2",
        variant: "outline",
        available: (r) => is("booked")(r) && !Number(r.amount_paid),
        run: async (ctx, r) => {
          await revertBill(ctx, r);
          return { message: "Bill reverted to draft." };
        },
      },
      {
        name: "cancel",
        label: "Cancel",
        description: "Cancels the bill and reverses its booking.",
        icon: "Ban",
        variant: "destructive",
        confirm: "Cancel this bill?",
        available: (r) => is("booked")(r) && !Number(r.amount_paid),
        run: async (ctx, r) => {
          await cancelBill(ctx, r);
          return { message: "Bill cancelled." };
        },
      },
    ],
  }),
  defineResource({
    name: "outgoing_payments",
    singular: "outgoing_payment",
    label: "Outgoing payment",
    labelPlural: "Outgoing payments",
    description: "Payment orders to suppliers; export as ISO 20022 pain.001 for e-banking.",
    table: "outgoing_payments",
    area: "banking",
    icon: "Send",
    nav: { group: "purchases", order: 20 },
    statusField: "status",
    fields: [
      f.date("execution_date", "Execution date", { required: true, list: true, sortable: true, filter: true, default: "$today", span: 2 }),
      f.money("amount", "Amount", { required: true, list: true, sortable: true, span: 2 }),
      f.enum("currency_code", "Currency", CURRENCY_OPTIONS, { default: "CHF", span: 2 }),
      f.string("recipient_name", "Recipient", { required: true, list: true, search: true, span: 3 }),
      f.iban("iban", "IBAN", { required: true, list: true, span: 3 }),
      f.string("qr_reference", "Reference", { span: 3 }),
      f.string("message", "Message", { search: true, span: 3 }),
      f.ref("bank_account_id", "From bank account", "bank_accounts", { list: true, filter: true, span: 3 }),
      f.ref("bill_id", "Bill", "bills", { list: true, filter: true, span: 3 }),
      f.ref("contact_id", "Supplier", "contacts", { filter: true, span: 3 }),
      f.enum(
        "status",
        "Status",
        [opt("open", "Open", "info"), opt("exported", "Exported", "primary"), opt("paid", "Paid", "success"), opt("cancelled", "Cancelled", "muted")],
        { readOnly: true, list: true, filter: true, default: "open" },
      ),
      f.datetime("exported_at", "Exported", { readOnly: true, hidden: true }),
      f.date("paid_at", "Paid on", { readOnly: true, list: true }),
      f.int("journal_entry_id", "Journal entry", { readOnly: true, hidden: true }),
    ],
    titleSql: "coalesce(recipient_name, 'Payment') || ' ' || printf('%.2f', amount / 100.0)",
    defaultSort: { field: "execution_date", dir: "asc" },
    hooks: {
      lockReason: (r) => (r.status === "open" ? null : "Only open payments can be edited."),
      beforeDelete: async (_ctx, r) => {
        if (r.status === "paid") throw new AppError("locked", "Paid payments cannot be deleted; cancel them instead.");
      },
    },
    actions: [
      {
        name: "mark_paid",
        label: "Mark as paid",
        description: "Books the payment (payables against bank).",
        icon: "CheckCheck",
        available: is("open", "exported"),
        input: [f.date("date", "Paid on", { required: true, default: "$today" })],
        run: async (ctx, r, input) => {
          await markOutgoingPaid(ctx, r, String(input.date ?? today()));
          return { message: "Payment booked." };
        },
      },
      {
        name: "cancel",
        label: "Cancel",
        description: "Cancels the payment and reverses its booking if paid.",
        icon: "Ban",
        variant: "destructive",
        available: (r) => r.status !== "cancelled",
        run: async (ctx, r) => {
          await cancelOutgoing(ctx, r);
          return { message: "Payment cancelled." };
        },
      },
    ],
  }),
  defineResource({
    name: "expenses",
    singular: "expense",
    label: "Expense",
    labelPlural: "Expenses",
    description: "Receipts paid directly in cash, by card or privately; booked with input VAT.",
    table: "expenses",
    area: "purchases",
    icon: "Wallet",
    nav: { group: "purchases", order: 40 },
    numbering: { field: "nr", sequence: "expense" },
    statusField: "status",
    fields: [
      f.string("nr", "Number", { list: true, search: true, sortable: true, span: 2, format: "code" }),
      f.string("title", "Title", { required: true, list: true, search: true, span: 4, format: "strong" }),
      f.date("date", "Date", { required: true, list: true, sortable: true, filter: true, default: "$today", span: 2 }),
      f.money("amount", "Amount (gross)", { required: true, list: true, sortable: true, span: 2 }),
      f.enum("currency_code", "Currency", CURRENCY_OPTIONS, { default: "CHF", span: 2 }),
      f.ref("tax_id", "Input VAT", "taxes", { refFilter: { type: "purchase" }, span: 2 }),
      f.ref("account_id", "Expense account", "accounts", { list: true, span: 2 }),
      f.ref("payment_account_id", "Paid from", "accounts", { span: 2, description: "Cash, bank, credit card or private account" }),
      f.ref("contact_id", "Supplier", "contacts", { filter: true, span: 3 }),
      f.ref("project_id", "Project", "projects", { filter: true, span: 3 }),
      f.ref("file_id", "Receipt", "files", { span: 3 }),
      f.text("notes", "Notes", { span: 6 }),
      f.enum("status", "Status", [opt("draft", "Draft", "muted"), opt("booked", "Booked", "success")], { readOnly: true, list: true, filter: true, default: "draft" }),
      f.int("journal_entry_id", "Journal entry", { readOnly: true, hidden: true }),
    ],
    titleSql: "coalesce(nr || ' – ', '') || title",
    defaultSort: { field: "date", dir: "desc" },
    hooks: {
      prepare: prepareExpense,
      afterWrite: (ctx, record) => linkSourceFile(ctx, "expenses", record),
      lockReason: (r) => (r.status === "draft" ? null : "Booked expenses cannot be edited. Revert to draft first."),
      beforeDelete: async (_ctx, r) => {
        if (r.status !== "draft") throw new AppError("locked", "Only draft expenses can be deleted.");
      },
    },
    actions: [
      {
        name: "book",
        label: "Book",
        description: "Books the expense with input VAT.",
        icon: "Stamp",
        available: is("draft"),
        run: async (ctx, r) => {
          await bookExpense(ctx, r);
          return { message: "Expense booked." };
        },
      },
      {
        name: "revert_to_draft",
        label: "Revert to draft",
        description: "Reverses the booking.",
        icon: "Undo2",
        variant: "outline",
        available: is("booked"),
        run: async (ctx, r) => {
          await revertExpense(ctx, r);
          return { message: "Expense reverted." };
        },
      },
    ],
  }),
];
