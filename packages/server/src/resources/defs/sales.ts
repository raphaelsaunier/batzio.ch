import { today } from "@batzio/core/format";
import { patchColumns } from "../../crud";
import { AppError } from "../../errors";
import {
  billFromPurchaseOrder,
  cancelDocument,
  convertDocument,
  copyDocument,
  createReminder,
  deletePayment,
  documentLockReason,
  issueDocument,
  markSent,
  prepareDocument,
  receivePurchaseOrder,
  recordPayment,
  revertToDraft,
  runRecurring,
  setDocumentStatus,
  writeOff,
  type DocKind,
} from "../../sales";
import { defineResource } from "../define";
import { CURRENCY_OPTIONS, LANGUAGE_OPTIONS, VAT_MODE_OPTIONS, f, opt } from "../fields";
import type { ActionDef, ChildDef, FieldDef, FieldOption, ResourceDef, Row } from "../types";

export const POSITION_TYPES: FieldOption[] = [
  opt("item", "Product / service"),
  opt("custom", "Free position"),
  opt("text", "Text"),
  opt("subtotal", "Subtotal"),
  opt("discount", "Discount"),
  opt("pagebreak", "Page break"),
];

export const positionsChild: ChildDef = {
  name: "positions",
  label: "Positions",
  table: "document_positions",
  foreignKey: "document_id",
  orderBy: "sort",
  fields: [
    f.int("id", "ID", { readOnly: true, hidden: true }),
    f.int("sort", "Sort", { hidden: true }),
    f.enum("type", "Type", POSITION_TYPES, { default: "custom", required: true }),
    f.ref("item_id", "Item", "items"),
    f.string("code", "Code"),
    f.text("text", "Description"),
    f.decimal("quantity", "Quantity"),
    f.string("unit_name", "Unit"),
    f.decimal("unit_price", "Unit price", { description: "Unit price in major units; for discount positions the fixed discount amount" }),
    f.percent("discount_percent", "Discount %"),
    f.ref("tax_id", "VAT", "taxes"),
    f.decimal("tax_rate", "VAT rate", { readOnly: true }),
    f.ref("account_id", "Account", "accounts"),
    f.boolean("is_optional", "Optional"),
    f.money("total", "Total", { readOnly: true }),
  ],
};

const STATUS: Record<DocKind, FieldOption[]> = {
  quote: [
    opt("draft", "Draft", "muted"),
    opt("open", "Open", "info"),
    opt("accepted", "Accepted", "success"),
    opt("rejected", "Declined", "danger"),
    opt("cancelled", "Cancelled", "muted"),
  ],
  order: [opt("draft", "Draft", "muted"), opt("open", "Confirmed", "info"), opt("done", "Done", "success"), opt("cancelled", "Cancelled", "muted")],
  delivery: [opt("draft", "Draft", "muted"), opt("delivered", "Delivered", "success"), opt("cancelled", "Cancelled", "muted")],
  invoice: [
    opt("draft", "Draft", "muted"),
    opt("open", "Open", "info"),
    opt("partial", "Partially paid", "warning"),
    opt("paid", "Paid", "success"),
    opt("written_off", "Written off", "danger"),
    opt("cancelled", "Cancelled", "muted"),
  ],
  credit_note: [opt("draft", "Draft", "muted"), opt("open", "Open", "info"), opt("partial", "Partially refunded", "warning"), opt("settled", "Settled", "success"), opt("cancelled", "Cancelled", "muted")],
  purchase_order: [
    opt("draft", "Draft", "muted"),
    opt("sent", "Sent", "info"),
    opt("confirmed", "Confirmed", "primary"),
    opt("received", "Received", "success"),
    opt("cancelled", "Cancelled", "muted"),
  ],
};

interface KindConfig {
  kind: DocKind;
  name: string;
  singular: string;
  label: string;
  labelPlural: string;
  description: string;
  icon: string;
  area: "sales" | "purchases";
  navGroup: "sales" | "purchases";
  order: number;
  dueLabel: string;
  actions: ActionDef[];
  extraFields?: FieldDef[];
  related?: ResourceDef["related"];
}

const redirectTo = (kind: DocKind, id: number) => ({
  redirect: {
    resource: { quote: "quotes", order: "orders", delivery: "deliveries", invoice: "invoices", credit_note: "credit_notes", purchase_order: "purchase_orders" }[kind],
    id,
  },
});

const is = (...statuses: string[]) => (r: Row) => statuses.includes(String(r.status));

const common = {
  issue: (label = "Issue", description = "Finalises the draft; it can no longer be edited.", done = "Document issued."): ActionDef => ({
    name: "issue",
    label,
    description,
    icon: "Stamp",
    variant: "default",
    available: is("draft"),
    run: async (ctx, r) => {
      await issueDocument(ctx, r);
      return { message: done };
    },
  }),
  revert: (): ActionDef => ({
    name: "revert_to_draft",
    label: "Revert to draft",
    description: "Reopens the document for editing and reverses any booking.",
    icon: "Undo2",
    variant: "outline",
    available: (r) => r.status !== "draft" && r.status !== "cancelled" && !Number(r.amount_paid),
    run: async (ctx, r) => {
      await revertToDraft(ctx, r);
      return { message: "Document reverted to draft." };
    },
  }),
  cancel: (statuses: string[]): ActionDef => ({
    name: "cancel",
    label: "Cancel",
    description: "Cancels the document and reverses any booking.",
    icon: "Ban",
    variant: "destructive",
    confirm: "Cancel this document? Bookings are reversed. This cannot be undone.",
    available: (r) => statuses.includes(String(r.status)) && !Number(r.amount_paid),
    run: async (ctx, r) => {
      await cancelDocument(ctx, r);
      return { message: "Document cancelled." };
    },
  }),
  copy: (kind: DocKind): ActionDef => ({
    name: "copy",
    label: "Duplicate",
    description: "Creates a new draft with the same content.",
    icon: "Copy",
    variant: "outline",
    run: async (ctx, r) => {
      const doc = await copyDocument(ctx, r);
      return { message: "Duplicate created.", ...redirectTo(kind, doc.id) };
    },
  }),
  convert: (target: DocKind, label: string, statuses: string[], description: string): ActionDef => ({
    name: `create_${target}`,
    label,
    description,
    icon: "FileOutput",
    variant: "outline",
    available: is(...statuses),
    run: async (ctx, r) => {
      const doc = await convertDocument(ctx, r, target);
      return { message: "Created — here it is.", ...redirectTo(target, doc.id) };
    },
  }),
  markSent: (): ActionDef => ({
    name: "mark_sent",
    label: "Mark as sent",
    description: "Records that the document was sent to the customer.",
    icon: "Send",
    variant: "outline",
    available: (r) => ["draft", "open", "partial"].includes(String(r.status)) && !r.sent_at,
    run: async (ctx, r) => {
      await markSent(ctx, r);
      return { message: "Marked as sent." };
    },
  }),
};

const paymentInput: FieldDef[] = [
  f.date("date", "Payment date", { required: true, default: "$today" }),
  f.money("amount", "Amount", { required: true, description: "Amount received in document currency" }),
  f.ref("bank_account_id", "Bank account", "bank_accounts"),
  f.ref("payment_type_id", "Payment type", "payment_types"),
  f.string("title", "Text"),
  f.boolean("is_cash_discount", "Cash discount (Skonto)", { description: "Books the amount as cash discount instead of a payment" }),
];

const KINDS: KindConfig[] = [
  {
    kind: "quote",
    name: "quotes",
    singular: "quote",
    label: "Quote",
    labelPlural: "Quotes",
    description: "Offers to customers. Accepted quotes convert into orders or invoices.",
    icon: "FileText",
    area: "sales",
    navGroup: "sales",
    order: 10,
    dueLabel: "Valid until",
    actions: [
      common.issue("Issue", "Finalises the quote so it can be sent."),
      common.markSent(),
      {
        name: "accept",
        label: "Accept",
        description: "Marks the quote as accepted by the customer.",
        icon: "ThumbsUp",
        available: is("open"),
        run: async (ctx, r) => {
          await setDocumentStatus(ctx, r, "accepted", { accepted_at: new Date().toISOString() });
          return { message: "Quote accepted." };
        },
      },
      {
        name: "reject",
        label: "Decline",
        description: "Marks the quote as declined.",
        icon: "ThumbsDown",
        variant: "outline",
        available: is("open"),
        run: async (ctx, r) => {
          await setDocumentStatus(ctx, r, "rejected", { rejected_at: new Date().toISOString() });
          return { message: "Quote declined." };
        },
      },
      common.convert("order", "Create order", ["open", "accepted"], "Creates an order from this quote."),
      common.convert("invoice", "Create invoice", ["open", "accepted"], "Creates an invoice from this document."),
      common.revert(),
      common.cancel(["open"]),
      common.copy("quote"),
    ],
    related: [{ resource: "comments", foreignKey: "document_id", label: "Comments" }],
  },
  {
    kind: "order",
    name: "orders",
    singular: "order",
    label: "Sales order",
    labelPlural: "Sales orders",
    description: "Confirmed customer orders; can be delivered, invoiced or billed recurringly.",
    icon: "ClipboardList",
    area: "sales",
    navGroup: "sales",
    order: 20,
    dueLabel: "Delivery date",
    extraFields: [
      f.json("repetition", "Recurring billing", {
        span: 6,
        section: "Recurring billing",
        description: 'JSON {"interval":"monthly|quarterly|semiannual|yearly|weekly|daily","every":1,"start":"YYYY-MM-DD","end":null}',
      }),
      f.date("next_run_date", "Next invoice date", { span: 2, list: true }),
    ],
    actions: [
      common.issue("Confirm order", "Confirms the order.", "Order confirmed."),
      common.convert("delivery", "Create delivery note", ["open"], "Creates a delivery note from this order."),
      common.convert("invoice", "Create invoice", ["open", "done"], "Creates an invoice from this document."),
      {
        name: "run_recurring",
        label: "Run recurring billing",
        description: "Creates all invoices that are due for recurring orders.",
        icon: "Repeat",
        variant: "outline",
        available: (r) => r.status === "open" && !!r.repetition,
        run: async (ctx) => {
          const ids = await runRecurring(ctx);
          return { message: ids.length ? "{n} invoice(s) created." : "No invoices are due yet.", vars: { n: ids.length }, data: ids };
        },
      },
      {
        name: "mark_done",
        label: "Mark as done",
        description: "Closes the order.",
        icon: "CheckCheck",
        variant: "outline",
        available: is("open"),
        run: async (ctx, r) => {
          await setDocumentStatus(ctx, r, "done");
          return { message: "Order closed." };
        },
      },
      common.revert(),
      common.cancel(["open"]),
      common.copy("order"),
    ],
    related: [{ resource: "comments", foreignKey: "document_id", label: "Comments" }],
  },
  {
    kind: "delivery",
    name: "deliveries",
    singular: "delivery",
    label: "Delivery note",
    labelPlural: "Delivery notes",
    description: "Delivery notes; delivering reduces tracked stock.",
    icon: "Truck",
    area: "sales",
    navGroup: "sales",
    order: 30,
    dueLabel: "Delivery date",
    actions: [common.issue("Deliver", "Marks the goods as delivered and books stock.", "Delivered; stock updated."), common.revert(), common.cancel(["delivered"]), common.copy("delivery")],
  },
  {
    kind: "invoice",
    name: "invoices",
    singular: "invoice",
    label: "Invoice",
    labelPlural: "Invoices",
    description: "Customer invoices with Swiss QR-bill, automatic booking, payments and dunning.",
    icon: "Receipt",
    area: "sales",
    navGroup: "sales",
    order: 40,
    dueLabel: "Due date",
    actions: [
      common.issue("Issue", "Finalises and books the invoice (receivables / revenue / VAT).", "Invoice issued and booked."),
      common.markSent(),
      {
        name: "record_payment",
        label: "Record payment",
        description: "Records a customer payment and books it to the bank account.",
        icon: "BadgeDollarSign",
        available: is("open", "partial"),
        input: paymentInput,
        run: async (ctx, r, input) => {
          await recordPayment(ctx, r, {
            date: String(input.date ?? today()),
            amount: Number(input.amount),
            bank_account_id: (input.bank_account_id as number) ?? null,
            payment_type_id: (input.payment_type_id as number) ?? null,
            title: (input.title as string) ?? null,
            is_cash_discount: Boolean(input.is_cash_discount),
          });
          return { message: "Payment recorded." };
        },
      },
      {
        name: "delete_payment",
        label: "Delete payment",
        description: "Deletes a recorded payment and reverses its booking.",
        icon: "Trash2",
        variant: "destructive",
        available: (r) => Number(r.amount_paid) > 0,
        input: [f.ref("payment_id", "Payment", "payments", { required: true, refFilter: { document_id: "$record.id" } })],
        run: async (ctx, r, input) => {
          await deletePayment(ctx, r, Number(input.payment_id));
          return { message: "Payment deleted." };
        },
      },
      {
        name: "create_reminder",
        label: "Create reminder",
        description: "Creates the next dunning level for an overdue invoice.",
        icon: "BellRing",
        variant: "outline",
        available: (r) => ["open", "partial"].includes(String(r.status)) && Number(r.reminder_level) < 3,
        run: async (ctx, r) => {
          const id = await createReminder(ctx, r);
          return { message: "Reminder created.", redirect: { resource: "reminders", id } };
        },
      },
      common.convert("credit_note", "Create credit note", ["open", "partial", "paid"], "Creates a credit note from this invoice."),
      {
        name: "write_off",
        label: "Write off",
        description: "Books the open amount as bad debt including VAT correction.",
        icon: "CircleSlash",
        variant: "destructive",
        confirm: "Write off the open amount as a loss?",
        available: is("open", "partial"),
        input: [f.date("date", "Date", { required: true, default: "$today" })],
        run: async (ctx, r, input) => {
          await writeOff(ctx, r, String(input.date ?? today()));
          return { message: "Open amount written off." };
        },
      },
      common.revert(),
      common.cancel(["open"]),
      common.copy("invoice"),
    ],
    related: [
      { resource: "payments", foreignKey: "document_id", label: "Payments" },
      { resource: "reminders", foreignKey: "document_id", label: "Reminders" },
      { resource: "comments", foreignKey: "document_id", label: "Comments" },
    ],
  },
  {
    kind: "credit_note",
    name: "credit_notes",
    singular: "credit_note",
    label: "Credit note",
    labelPlural: "Credit notes",
    description: "Credit notes reduce receivables and revenue including VAT.",
    icon: "ReceiptText",
    area: "sales",
    navGroup: "sales",
    order: 50,
    dueLabel: "Due date",
    actions: [
      common.issue("Issue", "Finalises and books the credit note.", "Credit note issued and booked."),
      {
        name: "record_payment",
        label: "Record refund",
        description: "Records the refund paid to the customer.",
        icon: "BadgeDollarSign",
        available: is("open", "partial"),
        input: paymentInput.filter((p) => p.name !== "is_cash_discount"),
        run: async (ctx, r, input) => {
          await recordPayment(ctx, r, {
            date: String(input.date ?? today()),
            amount: Number(input.amount),
            bank_account_id: (input.bank_account_id as number) ?? null,
            title: (input.title as string) ?? null,
          });
          return { message: "Refund recorded." };
        },
      },
      common.revert(),
      common.cancel(["open"]),
      common.copy("credit_note"),
    ],
    related: [{ resource: "payments", foreignKey: "document_id", label: "Refunds" }],
  },
  {
    kind: "purchase_order",
    name: "purchase_orders",
    singular: "purchase_order",
    label: "Purchase order",
    labelPlural: "Purchase orders",
    description: "Orders to suppliers; receiving goods increases tracked stock.",
    icon: "ShoppingCart",
    area: "purchases",
    navGroup: "purchases",
    order: 30,
    dueLabel: "Expected delivery",
    actions: [
      common.issue("Mark as sent", "Finalises the purchase order.", "Purchase order sent."),
      {
        name: "confirm",
        label: "Confirmed by supplier",
        description: "Marks the order as confirmed by the supplier.",
        icon: "BadgeCheck",
        variant: "outline",
        available: is("sent"),
        run: async (ctx, r) => {
          await setDocumentStatus(ctx, r, "confirmed");
          return { message: "Purchase order confirmed." };
        },
      },
      {
        name: "receive",
        label: "Goods received",
        description: "Books the received goods into stock.",
        icon: "PackageCheck",
        available: is("sent", "confirmed"),
        run: async (ctx, r) => {
          await receivePurchaseOrder(ctx, r);
          return { message: "Goods received." };
        },
      },
      {
        name: "create_bill",
        label: "Create supplier bill",
        description: "Creates a draft supplier bill from this purchase order.",
        icon: "FileOutput",
        variant: "outline",
        available: is("sent", "confirmed", "received"),
        run: async (ctx, r) => {
          const bill = await billFromPurchaseOrder(ctx, r);
          return { message: "Supplier bill created.", redirect: { resource: "bills", id: Number(bill.id) } };
        },
      },
      common.revert(),
      common.cancel(["sent", "confirmed"]),
      common.copy("purchase_order"),
    ],
  },
];

function documentFields(cfg: KindConfig): FieldDef[] {
  const isInvoiceLike = cfg.kind === "invoice" || cfg.kind === "credit_note";
  const party = cfg.kind === "purchase_order" ? "Supplier" : "Customer";
  return [
    f.string("kind", "Kind", { readOnly: true, hidden: true }),
    f.string("nr", "Number", { list: true, search: true, sortable: true, span: 2, format: "code", section: "Document" }),
    f.string("title", "Title", { list: true, search: true, span: 4 }),
    f.enum("status", "Status", STATUS[cfg.kind], { readOnly: true, list: true, filter: true, default: "draft" }),
    f.ref("contact_id", party, "contacts", {
      list: true,
      filter: true,
      span: 3,
      refFilter: cfg.kind === "purchase_order" ? { is_supplier: true } : undefined,
    }),
    f.ref("contact_person_id", "Contact person", "contacts", { refFilter: { type: "person" }, span: 3 }),
    f.date("date", "Date", { list: true, sortable: true, filter: true, default: "$today", span: 2 }),
    f.date("due_date", cfg.dueLabel, { list: isInvoiceLike || cfg.kind === "quote", sortable: true, filter: true, span: 2 }),
    f.string("reference", "Reference", { search: true, span: 2, placeholder: "Your order no." }),
    f.text("address", "Address", { span: 3, section: "Addresses", description: "Address block printed on the document; filled from the contact" }),
    f.text("delivery_address", "Delivery address", { span: 3 }),
    f.enum("language", "Language", LANGUAGE_OPTIONS, { span: 2, section: "Settings" }),
    f.enum("currency_code", "Currency", CURRENCY_OPTIONS, { span: 1 }),
    f.decimal("exchange_rate", "Exchange rate", { default: 1, span: 1 }),
    f.enum("vat_mode", "VAT", VAT_MODE_OPTIONS, { span: 2 }),
    f.ref("payment_term_id", "Payment term", "payment_terms", { span: 2 }),
    f.ref("bank_account_id", "Bank account", "bank_accounts", { span: 2, hidden: cfg.kind === "purchase_order" || cfg.kind === "delivery" }),
    f.ref("project_id", "Project", "projects", { filter: true, span: 2 }),
    f.string("responsible_user_id", "Responsible", { hidden: true }),
    f.text("header", "Introduction text", { span: 6, section: "Texts" }),
    f.text("footer", "Closing text", { span: 6 }),
    f.text("notes", "Internal notes", { span: 6 }),
    ...(cfg.extraFields ?? []),
    f.money("total_net", "Net", { readOnly: true }),
    f.money("total_vat", "VAT", { readOnly: true }),
    f.money("rounding", "Rounding", { readOnly: true }),
    f.money("total", "Total", { readOnly: true, list: true, sortable: true }),
    f.money("amount_paid", isInvoiceLike ? "Paid" : "Paid", { readOnly: true, hidden: !isInvoiceLike }),
    f.money("amount_open", "Open", { readOnly: true, list: cfg.kind === "invoice", sortable: true, hidden: !isInvoiceLike }),
    f.string("qr_reference", "QR reference", { readOnly: true, hidden: cfg.kind !== "invoice" }),
    f.int("reminder_level", "Reminder level", { readOnly: true, hidden: cfg.kind !== "invoice", filter: true }),
    f.int("source_id", "Created from", { hidden: true }),
    f.int("journal_entry_id", "Journal entry", { readOnly: true, hidden: true }),
    f.datetime("issued_at", "Issued", { readOnly: true, hidden: true }),
    f.datetime("sent_at", "Sent", { readOnly: true, hidden: true }),
    f.datetime("accepted_at", "Accepted", { readOnly: true, hidden: true }),
    f.datetime("rejected_at", "Declined", { readOnly: true, hidden: true }),
    f.datetime("cancelled_at", "Cancelled", { readOnly: true, hidden: true }),
    f.datetime("paid_at", "Paid", { readOnly: true, hidden: true }),
  ];
}

export const documentResources: ResourceDef[] = KINDS.map((cfg) =>
  defineResource({
    name: cfg.name,
    singular: cfg.singular,
    label: cfg.label,
    labelPlural: cfg.labelPlural,
    description: cfg.description,
    table: "documents",
    area: cfg.area,
    icon: cfg.icon,
    nav: { group: cfg.navGroup, order: cfg.order },
    scope: { kind: cfg.kind },
    numbering: { field: "nr", sequence: cfg.kind },
    fields: documentFields(cfg),
    children: [positionsChild],
    titleSql: "coalesce(nr, '#' || id) || coalesce(' – ' || title, '')",
    defaultSort: { field: "date", dir: "desc" },
    view: "document",
    statusField: "status",
    actions: cfg.actions,
    related: cfg.related,
    hooks: {
      prepare: (ctx, data, existing) => prepareDocument(ctx, cfg.kind, data, existing),
      lockReason: documentLockReason,
      beforeDelete: async (_ctx, r) => {
        if (r.status !== "draft") throw new AppError("locked", "Only drafts can be deleted. Cancel the document instead.");
      },
    },
  }),
);

export const salesAuxResources: ResourceDef[] = [
  defineResource({
    name: "payments",
    singular: "payment",
    label: "Payment",
    labelPlural: "Customer payments",
    description: "Payments recorded against invoices and refunds of credit notes.",
    table: "document_payments",
    area: "sales",
    icon: "HandCoins",
    nav: { group: "sales", order: 60 },
    readOnly: true,
    fields: [
      f.date("date", "Date", { list: true, sortable: true, filter: true }),
      f.ref("document_id", "Document", "invoices", { list: true, filter: true }),
      f.money("amount", "Amount", { list: true, sortable: true }),
      f.ref("bank_account_id", "Bank account", "bank_accounts", { list: true, filter: true }),
      f.ref("payment_type_id", "Payment type", "payment_types", { list: true }),
      f.boolean("is_cash_discount", "Cash discount", { list: true }),
      f.string("title", "Text", { list: true, search: true }),
      f.int("bank_transaction_id", "Bank transaction", { hidden: true }),
      f.int("journal_entry_id", "Journal entry", { hidden: true }),
    ],
    titleSql: "date || ' ' || printf('%.2f', amount / 100.0)",
    defaultSort: { field: "date", dir: "desc" },
  }),
  defineResource({
    name: "reminders",
    singular: "reminder",
    label: "Reminder",
    labelPlural: "Reminders",
    description: "Dunning letters (levels 1–3) for overdue invoices, with optional fees.",
    table: "reminders",
    area: "sales",
    icon: "BellRing",
    nav: { group: "sales", order: 70 },
    noCreate: true,
    fields: [
      f.ref("document_id", "Invoice", "invoices", { required: true, list: true, filter: true, createOnly: true, span: 3 }),
      f.int("level", "Level", { list: true, filter: true, readOnly: true }),
      f.string("title", "Title", { list: true, search: true, span: 6 }),
      f.date("date", "Date", { list: true, sortable: true, span: 2 }),
      f.date("due_date", "Pay by", { list: true, span: 2 }),
      f.money("fee", "Fee", { list: true, span: 2 }),
      f.text("header", "Text", { span: 6 }),
      f.text("footer", "Closing text", { span: 6 }),
      f.enum("status", "Status", [opt("draft", "Draft", "muted"), opt("sent", "Sent", "info")], { readOnly: true, list: true, filter: true }),
      f.datetime("sent_at", "Sent", { readOnly: true, hidden: true }),
    ],
    titleSql: "title",
    defaultSort: { field: "date", dir: "desc" },
    statusField: "status",
    actions: [
      {
        name: "mark_sent",
        label: "Mark as sent",
        description: "Records that the reminder was sent.",
        icon: "Send",
        available: (r) => r.status === "draft",
        run: async (ctx, r) => {
          await patchColumns(ctx, { table: "reminders" }, Number(r.id), { status: "sent", sent_at: new Date().toISOString() });
          return { message: "Reminder marked as sent." };
        },
      },
      {
        name: "mark_unsent",
        label: "Mark as not sent",
        description: "Reverts the sent flag.",
        icon: "Undo2",
        variant: "outline",
        available: (r) => r.status === "sent",
        run: async (ctx, r) => {
          await patchColumns(ctx, { table: "reminders" }, Number(r.id), { status: "draft", sent_at: null });
          return { message: "Reminder marked as not sent." };
        },
      },
    ],
  }),
  defineResource({
    name: "comments",
    singular: "comment",
    label: "Comment",
    labelPlural: "Comments",
    description: "Internal or customer-visible comments on sales documents.",
    table: "comments",
    area: "sales",
    icon: "MessageSquare",
    nav: false,
    fields: [
      f.int("document_id", "Document", { required: true, list: true, filter: true, createOnly: true }),
      f.text("body", "Comment", { required: true, list: true, search: true, span: 6 }),
      f.boolean("is_public", "Visible to customer", { list: true }),
      f.string("user_name", "Author", { readOnly: true, list: true }),
    ],
    titleSql: "substr(body, 1, 60)",
    defaultSort: { field: "id", dir: "desc" },
    hooks: {
      prepare: (ctx, data, existing) => (existing ? data : { ...data, user_name: ctx.actor.name }),
    },
  }),
];
