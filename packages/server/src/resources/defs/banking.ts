import { bookTransaction, suggestMatch } from "../../banking";
import { patchColumns } from "../../crud";
import { AppError } from "../../errors";
import { isQrIban } from "@batzio/core/swiss/iban";
import { defineResource } from "../define";
import { CURRENCY_OPTIONS, f, opt } from "../fields";
import type { ResourceDef } from "../types";

export const bankingResources: ResourceDef[] = [
  defineResource({
    name: "bank_accounts",
    singular: "bank_account",
    label: "Bank account",
    labelPlural: "Bank accounts",
    description: "Bank and postal accounts with IBAN/QR-IBAN, linked to a ledger account.",
    table: "bank_accounts",
    area: "banking",
    icon: "Landmark",
    nav: { group: "banking", order: 10 },
    fields: [
      f.string("name", "Name", { required: true, list: true, search: true, span: 3, format: "strong" }),
      f.string("bank_name", "Bank", { list: true, span: 3 }),
      f.iban("iban", "IBAN", { list: true, span: 3 }),
      f.iban("qr_iban", "QR-IBAN", { span: 3, description: "Enables QR references (QRR) on invoices" }),
      f.string("bic", "BIC / SWIFT", { span: 2 }),
      f.string("qr_reference_prefix", "QR reference prefix", { span: 2, description: "Customer id issued by the bank (optional)" }),
      f.enum("currency_code", "Currency", CURRENCY_OPTIONS, { default: "CHF", list: true, span: 2 }),
      f.ref("account_id", "Ledger account", "accounts", { list: true, span: 3, refFilter: { type: "asset" } }),
      f.boolean("is_default", "Default account", { list: true, span: 3 }),
    ],
    titleSql: "name",
    defaultSort: { field: "name", dir: "asc" },
    related: [{ resource: "bank_transactions", foreignKey: "bank_account_id", label: "Transactions" }],
    hooks: {
      prepare: async (ctx, data) => {
        if (data.qr_iban && !isQrIban(String(data.qr_iban))) {
          throw new AppError("validation", "This is not a QR-IBAN (institution id 30000–31999).", { qr_iban: "Not a QR-IBAN" });
        }
        if (data.is_default) await ctx.db.run("UPDATE bank_accounts SET is_default = 0");
        return data;
      },
    },
  }),
  defineResource({
    name: "bank_transactions",
    singular: "bank_transaction",
    label: "Bank transaction",
    labelPlural: "Bank transactions",
    description: "Imported bank statement lines (camt.053/054, CSV) for reconciliation.",
    table: "bank_transactions",
    area: "banking",
    icon: "ArrowRightLeft",
    nav: { group: "banking", order: 20 },
    statusField: "status",
    fields: [
      f.ref("bank_account_id", "Bank account", "bank_accounts", { required: true, list: true, filter: true, span: 3 }),
      f.date("booking_date", "Booking date", { required: true, list: true, sortable: true, filter: true, span: 2 }),
      f.date("value_date", "Value date", { span: 2 }),
      f.money("amount", "Amount", { required: true, list: true, sortable: true, span: 2, description: "Positive = incoming, negative = outgoing" }),
      f.enum("currency_code", "Currency", CURRENCY_OPTIONS, { default: "CHF", span: 1 }),
      f.string("counterparty", "Counterparty", { list: true, search: true, span: 3 }),
      f.string("counterparty_iban", "Counterparty IBAN", { span: 3 }),
      f.string("reference", "Reference", { search: true, span: 3 }),
      f.text("remittance", "Remittance information", { list: true, search: true, span: 6 }),
      f.enum(
        "status",
        "Status",
        [opt("unmatched", "Unmatched", "warning"), opt("suggested", "Match suggested", "info"), opt("booked", "Booked", "success"), opt("ignored", "Ignored", "muted")],
        { readOnly: true, list: true, filter: true, default: "unmatched" },
      ),
      f.string("match_type", "Matched to", { readOnly: true }),
      f.int("match_id", "Match ID", { readOnly: true }),
      f.int("journal_entry_id", "Journal entry", { readOnly: true, hidden: true }),
      f.string("external_id", "Bank reference", { readOnly: true, hidden: true }),
      f.string("import_batch", "Import", { readOnly: true, hidden: true, filter: true }),
    ],
    titleSql: "booking_date || ' ' || coalesce(counterparty, '') || ' ' || printf('%.2f', amount / 100.0)",
    defaultSort: { field: "booking_date", dir: "desc" },
    hooks: {
      lockReason: (r) => (r.status === "booked" ? "Booked transactions cannot be edited." : null),
    },
    actions: [
      {
        name: "book_suggestion",
        label: "Confirm match",
        description: "Books the transaction against the suggested invoice or payment.",
        icon: "CheckCheck",
        available: (r) => r.status === "suggested" && !!r.match_type,
        run: async (ctx, r) => {
          await bookTransaction(ctx, Number(r.id), { type: r.match_type as "invoice" | "outgoing_payment", id: Number(r.match_id) });
          return { message: "Transaction booked." };
        },
      },
      {
        name: "book_invoice",
        label: "Assign invoice",
        description: "Books an incoming payment against an invoice.",
        icon: "Receipt",
        variant: "outline",
        available: (r) => r.status !== "booked" && Number(r.amount) > 0,
        input: [f.ref("invoice_id", "Invoice", "invoices", { required: true, refFilter: { status: "open" } })],
        run: async (ctx, r, input) => {
          await bookTransaction(ctx, Number(r.id), { type: "invoice", id: Number(input.invoice_id) });
          return { message: "Payment assigned to invoice." };
        },
      },
      {
        name: "book_account",
        label: "Book to account",
        description: "Books the transaction against any ledger account (e.g. bank fees, rent).",
        icon: "BookOpen",
        variant: "outline",
        available: (r) => r.status !== "booked",
        input: [
          f.ref("account_id", "Contra account", "accounts", { required: true }),
          f.ref("tax_id", "VAT", "taxes"),
          f.string("description", "Text"),
        ],
        run: async (ctx, r, input) => {
          await bookTransaction(ctx, Number(r.id), {
            type: "account",
            account_id: Number(input.account_id),
            tax_id: (input.tax_id as number) ?? null,
            description: (input.description as string) ?? null,
          });
          return { message: "Transaction booked." };
        },
      },
      {
        name: "rematch",
        label: "Find match",
        description: "Searches for a matching open invoice or payment.",
        icon: "Search",
        variant: "outline",
        level: "write",
        available: (r) => r.status === "unmatched",
        run: async (ctx, r) => {
          const m = await suggestMatch(ctx, Number(r.id));
          return { message: m ? "A match was found." : "No match found." };
        },
      },
      {
        name: "ignore",
        label: "Ignore",
        description: "Excludes the transaction from reconciliation.",
        icon: "EyeOff",
        variant: "outline",
        available: (r) => r.status !== "booked" && r.status !== "ignored",
        run: async (ctx, r) => {
          await patchColumns(ctx, { table: "bank_transactions" }, Number(r.id), { status: "ignored" });
          return { message: "Transaction ignored." };
        },
      },
    ],
  }),
];
