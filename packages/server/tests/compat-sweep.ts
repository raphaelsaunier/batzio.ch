import { compatRoutes, dispatchCompat } from "../src/compat/index";
import { uuidFor } from "../src/compat/wire";
import type { Ctx } from "../src/ctx";
import { storeFile } from "../src/files";

type Json = any;

export interface SweepResult {
  key: string;
  status: number;
  message?: string;
  body?: Json;
}

/**
 * Calls every documented operation once against a demo company. The records
 * each call needs are created first through the compatibility API itself;
 * request bodies come from the specification's own examples, with ids
 * replaced by records that exist, and each workflow action gets a document in
 * a state where the action applies.
 */
export async function sweep(ctx: Ctx, spec: Json): Promise<SweepResult[]> {
  const call = async (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method };
    if (body !== undefined) init.body = JSON.stringify(body);
    if (body !== undefined) init.headers = { "Content-Type": "application/json" };
    const res = await dispatchCompat(async () => ctx, new Request(`https://batzio.test/api/compat${path}`, init), path.split("?")[0]);
    const text = (res.headers.get("content-type") ?? "").includes("json") ? await res.text() : "";
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const ok = async (method: string, path: string, body?: unknown) => {
    const r = await call(method, path, body);
    if (r.status >= 300) throw new Error(`fixture ${method} ${path}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const one = async (sql: string, ...args: unknown[]) => Number(await ctx.db.value(sql, ...args)) || 0;

  // Team members for /3.0/users.
  await ctx.control.run("INSERT OR IGNORE INTO tenants (id, slug, name) VALUES (?, ?, ?)", ctx.tenant.id, ctx.tenant.slug, ctx.tenant.name);
  await ctx.control.run("INSERT OR IGNORE INTO users (id, email, name, password_hash) VALUES (?, ?, ?, 'x')", ctx.user!.id, ctx.user!.email, ctx.user!.name);
  await ctx.control.run("INSERT OR IGNORE INTO memberships (user_id, tenant_id, role) VALUES (?, ?, 'owner')", ctx.user!.id, ctx.tenant.id);

  const accounts = await ctx.db.all<{ id: number; type: string }>("SELECT id, type FROM accounts WHERE is_active = 1 ORDER BY number");
  const expenseAccount = accounts.find((a) => a.type === "expense")!.id;
  const revenueAccount = accounts.find((a) => a.type === "revenue")!.id;
  const bankLedger = await one("SELECT account_id FROM bank_accounts ORDER BY id LIMIT 1");
  const salesTax = await one("SELECT id FROM taxes WHERE type = 'sales' AND rate = 8.1 ORDER BY id LIMIT 1");
  const contact = await one("SELECT id FROM contacts WHERE archived_at IS NULL ORDER BY id LIMIT 1");
  const project = await one("SELECT id FROM projects ORDER BY id LIMIT 1");
  const article = await one("SELECT id FROM items ORDER BY id LIMIT 1");
  const position = (text: string) => ({ type: "KbPositionCustom", amount: "1", unit_price: "100", tax_id: salesTax, account_id: revenueAccount, text });

  // Documents in the states the workflow actions need.
  const draftInvoice = (await ok("POST", "/2.0/kb_invoice", { contact_id: contact, title: "Sweep draft", positions: [position("Draft")] })).id;
  const openInvoice = (await ok("POST", "/2.0/kb_invoice", { contact_id: contact, title: "Sweep open", is_valid_from: "2026-01-10", is_valid_to: "2026-02-09", positions: [position("Open")] })).id;
  await ok("POST", `/2.0/kb_invoice/${openInvoice}/issue`);
  const paidInvoice = (await ok("POST", "/2.0/kb_invoice", { contact_id: contact, title: "Sweep paid", positions: [position("Paid")] })).id;
  await ok("POST", `/2.0/kb_invoice/${paidInvoice}/issue`);
  const payment = (await ok("POST", `/2.0/kb_invoice/${paidInvoice}/payment`, { date: "2026-10-01", value: "10.00" })).id;
  const reminder = (await ok("POST", `/2.0/kb_invoice/${openInvoice}/kb_reminder`)).id;
  const issued = async (type: string) => {
    const id = (await ok("POST", `/2.0/${type}`, { contact_id: contact, positions: [position(type)] })).id;
    await ok("POST", `/2.0/${type}/${id}/issue`);
    return id;
  };
  const draft = async (type: string) => (await ok("POST", `/2.0/${type}`, { contact_id: contact, positions: [position(type)] })).id;
  const invoiceFor = {
    issue: await draft("kb_invoice"),
    delete: await draft("kb_invoice"),
    revert: await issued("kb_invoice"),
    cancel: await issued("kb_invoice"),
    payment: await issued("kb_invoice"),
  };
  const quoteFor = { issue: await draft("kb_offer"), delete: await draft("kb_offer"), revert: await issued("kb_offer"), accept: await issued("kb_offer"), reject: await issued("kb_offer") };
  const draftQuote = (await ok("POST", "/2.0/kb_offer", { contact_id: contact, positions: [position("Quote")] })).id;
  const openQuote = (await ok("POST", "/2.0/kb_offer", { contact_id: contact, positions: [position("Quote")] })).id;
  await ok("POST", `/2.0/kb_offer/${openQuote}/issue`);
  const draftOrder = (await ok("POST", "/2.0/kb_order", { contact_id: contact, positions: [position("Order")] })).id;
  const openOrder = (await ok("POST", "/2.0/kb_order", { contact_id: contact, positions: [position("Order")] })).id;
  await ok("POST", `/2.0/kb_order/${openOrder}/repetition`, { start: "2026-11-01", repetition: { type: "monthly", interval: 1 } });
  const delivery = (await ok("POST", `/2.0/kb_order/${openOrder}/delivery`, {})).id;

  // One position of every type on the draft invoice.
  const positionIds: Record<string, number> = {};
  for (const [segment, body] of Object.entries({
    kb_position_custom: position("Custom"),
    kb_position_article: { article_id: article, amount: "2" },
    kb_position_text: { text: "Text" },
    kb_position_subtotal: { text: "Subtotal" },
    kb_position_discount: { text: "Discount", is_percentual: true, value: "5" },
    kb_position_pagebreak: { pagebreak: true },
    kb_position_subposition: { text: "Group", show_pos_nr: true },
  })) positionIds[segment] = (await ok("POST", `/2.0/kb_invoice/${draftInvoice}/${segment}`, body)).id;
  const comment = (await ok("POST", `/2.0/kb_invoice/${draftInvoice}/comment`, { text: "Sweep", user_id: 1, user_name: "Sweep", is_public: false })).id;

  const address = (await ok("POST", `/2.0/contact/${contact}/additional_address`, { name: "Lager", street_name: "Weg", house_number: "1", postcode: "8000", city: "Zürich", country_id: 1, subject: "Lieferung", description: "" })).id;
  const note = (await ok("POST", "/2.0/note", { user_id: 1, event_start: "2026-10-01 10:00:00", subject: "Sweep", contact_id: contact })).id;
  const fictional = (await ok("POST", "/3.0/fictional_users", { salutation_type: "female", firstname: "Erika", lastname: "Muster", email: "erika@example.com" })).id;
  const milestone = (await ok("POST", `/3.0/projects/${project}/milestones`, { name: "Sweep", end_date: "2026-12-31" })).id;
  const workPackage = (await ok("POST", `/3.0/projects/${project}/packages`, { name: "Sweep", estimated_time_in_hours: 5 })).id;
  const calendarYear = (await ok("POST", "/3.0/accounting/calendar_years", { year: "2031", is_vat_subject: true, vat_accounting_method: "effective", vat_accounting_type: "agreed" }))[0].id;
  const manualToDelete = (
    await ok("POST", "/3.0/accounting/manual_entries", {
      type: "manual_single_entry",
      date: "2026-10-15",
      entries: [{ debit_account_id: expenseAccount, credit_account_id: bankLedger, amount: 1, description: "Delete me" }],
    })
  ).id;
  const manual = await ok("POST", "/3.0/accounting/manual_entries", {
    type: "manual_single_entry",
    date: "2026-10-15",
    entries: [{ debit_account_id: expenseAccount, credit_account_id: bankLedger, amount: 12.5, description: "Sweep" }],
  });
  const purchaseOrder = (await ok("POST", "/3.0/purchase_orders", { contact_id: contact, title: "Sweep", positions: { required: [{ type: "custom", amount: 1, unit_price: 10, text: "PO" }] } })).id;
  const entryFile = await storeFile(ctx, { name: "line.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4").buffer as ArrayBuffer }, { type: "journal_lines", id: manual.entries[0].id });
  const entryFile2 = await storeFile(ctx, { name: "entry.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4").buffer as ArrayBuffer }, { type: "journal_entries", id: manual.id });
  const file = await storeFile(ctx, { name: "receipt.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4").buffer as ArrayBuffer }, { type: "documents", id: draftInvoice });
  // Receipts of booked records are kept for ten years, so the deletion gets a loose file of its own.
  const spareFile = await storeFile(ctx, { name: "spare.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4 spare").buffer as ArrayBuffer });

  const bill = (pay: boolean) =>
    ok("POST", "/4.0/purchase/bills", {
      supplier_id: contact,
      contact_partner_id: contact,
      bill_date: "2026-10-02",
      due_date: "2026-11-01",
      currency_code: "CHF",
      item_net: false,
      manual_amount: false,
      attachment_ids: [],
      address: { lastname_company: "Sweep", type: "COMPANY" },
      line_items: [{ position: 0, title: "Sweep", amount: 100, booking_account_id: expenseAccount }],
      discounts: [],
      ...(pay ? { payment: { type: "IBAN", iban: "CH9300762011623852957", execution_date: "2026-10-30", amount: 100, salary_payment: false } } : {}),
    });
  const draftBill = (await bill(false)).id;
  const billToDelete = (await bill(false)).id;
  const expenseToBook = (await ok("POST", "/4.0/expenses", { paid_on: "2026-10-03", currency_code: "CHF", amount: 8, booking_account_id: expenseAccount, attachment_ids: [] })).id;
  const expenseToDelete = (await ok("POST", "/4.0/expenses", { paid_on: "2026-10-03", currency_code: "CHF", amount: 9, booking_account_id: expenseAccount, attachment_ids: [] })).id;
  const bookedBill = (await bill(true)).id;
  await ok("PUT", `/4.0/purchase/bills/${bookedBill}/bookings/BOOKED`);
  const outgoing = (await ok("GET", `/4.0/purchase/outgoing-payments?bill_id=${bookedBill}`)).data[0].id;
  const bankingPayment = (
    await ok("POST", "/4.0/banking/payments", {
      account_id: uuidFor(4, await one("SELECT id FROM bank_accounts ORDER BY id LIMIT 1")),
      amount: 25,
      currency: "CHF",
      execution_date: "2026-10-28",
      is_salary: false,
      type: "iban",
      recipient: { name: "Sweep GmbH", iban: "CH9300762011623852957", address: { street_name: "Weg", house_number: "2", zip: "3000", city: "Bern", country_code: "CH" } },
    })
  ).id;
  const paymentToCancel = (
    await ok("POST", "/4.0/banking/payments", {
      account_id: uuidFor(4, await one("SELECT id FROM bank_accounts ORDER BY id LIMIT 1")),
      amount: 5,
      currency: "CHF",
      execution_date: "2026-10-28",
      is_salary: false,
      type: "iban",
      recipient: { name: "Sweep AG", iban: "CH9300762011623852957", address: { street_name: "Weg", house_number: "3", zip: "3000", city: "Bern", country_code: "CH" } },
    })
  ).id;
  const manualToEdit = (
    await ok("POST", "/3.0/accounting/manual_entries", {
      type: "manual_single_entry",
      date: "2026-10-15",
      entries: [{ debit_account_id: expenseAccount, credit_account_id: bankLedger, amount: 2, description: "Edit me" }],
    })
  ).id;
  const otherContact = await one("SELECT id FROM contacts WHERE id != ? ORDER BY id LIMIT 1", contact);
  const expense = (await ok("POST", "/4.0/expenses", { paid_on: "2026-10-03", currency_code: "CHF", amount: 42.5, booking_account_id: expenseAccount, attachment_ids: [] })).id;
  const employee = (await ok("GET", "/4.0/payroll/employees")).data[0].id;
  const absence = (await ok("POST", `/4.0/payroll/employees/${employee}/absences`, { reason: "vacation", start_date: "2026-08-03", end_date: "2026-08-07" })).id;
  const slip = await ctx.db.first<{ year: number; month: number; employee_id: number }>("SELECT year, month, employee_id FROM payslips ORDER BY id LIMIT 1");

  const ids: Record<string, string | number> = {
    contact_id: contact,
    additional_address_id: address,
    contact_relation_id: await one("SELECT id FROM contact_relations ORDER BY id LIMIT 1"),
    contact_group_id: await one("SELECT id FROM contact_groups ORDER BY id DESC LIMIT 1"),
    salutation_id: await one("SELECT id FROM salutations ORDER BY id DESC LIMIT 1"),
    title_id: await one("SELECT id FROM titles ORDER BY id DESC LIMIT 1"),
    country_id: await one("SELECT id FROM countries ORDER BY id DESC LIMIT 1"),
    unit_id: await one("SELECT id FROM units WHERE id NOT IN (SELECT coalesce(unit_id, 0) FROM items) ORDER BY id DESC LIMIT 1"),
    note_id: note,
    task_id: await one("SELECT id FROM tasks ORDER BY id LIMIT 1"),
    article_id: article,
    quote_id: draftQuote,
    order_id: draftOrder,
    invoice_id: draftInvoice,
    delivery_id: delivery,
    document_id: draftInvoice,
    kb_document_type: "kb_invoice",
    comment_id: comment,
    payment_id: payment,
    reminder_id: reminder,
    project_id: project,
    timesheet_id: await one("SELECT id FROM timesheets ORDER BY id LIMIT 1"),
    milestone_id: milestone,
    package_id: workPackage,
    business_year_id: await one("SELECT id FROM business_years ORDER BY id LIMIT 1"),
    calendar_year_id: calendarYear,
    manual_entry_id: manual.id,
    entry_id: manual.entries[0].id,
    vat_period_id: await one("SELECT id FROM vat_periods ORDER BY id LIMIT 1"),
    bank_account_id: await one("SELECT id FROM bank_accounts ORDER BY id LIMIT 1"),
    currency_id: await one("SELECT id FROM currencies WHERE code = 'EUR'"),
    tax_id: await one("SELECT id FROM taxes WHERE id NOT IN (SELECT coalesce(tax_id, 0) FROM document_positions) AND id NOT IN (SELECT coalesce(tax_id, 0) FROM journal_lines) ORDER BY id DESC LIMIT 1"),
    fictional_user_id: fictional,
    purchase_order_id: purchaseOrder,
    profile_id: 1,
    user_id: (await ok("GET", "/3.0/users/me")).id,
    file_id: file.id,
    employeeId: employee,
    absenceId: absence,
    year: String(slip?.year ?? 2026),
    month: String(slip?.month ?? 1),
    status: "BOOKED",
  };

  /** Path parameters that differ per operation (a document in the right state, …). */
  const override: Record<string, Record<string, string | number>> = {
    "GET /2.0/kb_invoice/{}/payment/{}": { invoice_id: paidInvoice },
    "DELETE /2.0/kb_invoice/{}/payment/{}": { invoice_id: paidInvoice },
    "GET /2.0/kb_invoice/{}/payment": { invoice_id: paidInvoice },
    "POST /2.0/kb_invoice/{}/payment": { invoice_id: invoiceFor.payment },
    "POST /2.0/kb_invoice/{}/issue": { invoice_id: invoiceFor.issue },
    "DELETE /2.0/kb_invoice/{}": { invoice_id: invoiceFor.delete },
    "POST /2.0/kb_invoice/{}/revert_issue": { invoice_id: invoiceFor.revert },
    "POST /2.0/kb_invoice/{}/mark_as_sent": { invoice_id: openInvoice },
    "POST /2.0/kb_invoice/{}/cancel": { invoice_id: invoiceFor.cancel },
    "POST /2.0/kb_offer/{}/issue": { quote_id: quoteFor.issue },
    "DELETE /2.0/kb_offer/{}": { quote_id: quoteFor.delete },
    "DELETE /3.0/accounting/manual_entries/{}": { manual_entry_id: manualToDelete },
    "PUT /3.0/accounting/manual_entries/{}": { manual_entry_id: manualToEdit },
    "DELETE /4.0/purchase/bills/{}": { id: billToDelete },
    "DELETE /4.0/expenses/{}": { id: expenseToDelete },
    "POST /2.0/kb_invoice/{}/send": { invoice_id: openInvoice },
    "POST /2.0/kb_invoice/{}/copy": { invoice_id: openInvoice },
    "GET /2.0/kb_invoice/{}/kb_reminder": { invoice_id: openInvoice },
    "POST /2.0/kb_invoice/{}/kb_reminder": { invoice_id: paidInvoice },
    "POST /2.0/kb_invoice/{}/kb_reminder/search": { invoice_id: openInvoice },
    "GET /2.0/kb_invoice/{}/kb_reminder/{}": { invoice_id: openInvoice },
    "GET /2.0/kb_invoice/{}/kb_reminder/{}/pdf": { invoice_id: openInvoice },
    "POST /2.0/kb_invoice/{}/kb_reminder/{}/mark_as_sent": { invoice_id: openInvoice },
    "POST /2.0/kb_invoice/{}/kb_reminder/{}/mark_as_unsent": { invoice_id: openInvoice },
    "POST /2.0/kb_invoice/{}/kb_reminder/{}/send": { invoice_id: openInvoice },
    "DELETE /2.0/kb_invoice/{}/kb_reminder/{}": { invoice_id: openInvoice },
    "POST /2.0/kb_offer/{}/revertIssue": { quote_id: quoteFor.revert },
    "POST /2.0/kb_offer/{}/accept": { quote_id: quoteFor.accept },
    "POST /2.0/kb_offer/{}/reject": { quote_id: quoteFor.reject },
    "POST /2.0/kb_offer/{}/reissue": { quote_id: openQuote },
    "POST /2.0/kb_offer/{}/mark_as_sent": { quote_id: openQuote },
    "POST /2.0/kb_offer/{}/send": { quote_id: openQuote },
    "POST /2.0/kb_offer/{}/order": { quote_id: openQuote },
    "POST /2.0/kb_offer/{}/invoice": { quote_id: openQuote },
    "POST /2.0/kb_order/{}/delivery": { order_id: openOrder },
    "POST /2.0/kb_order/{}/invoice": { order_id: openOrder },
    "GET /2.0/kb_order/{}/repetition": { order_id: openOrder },
    "POST /2.0/kb_order/{}/repetition": { order_id: openOrder },
    "DELETE /2.0/kb_order/{}/repetition": { order_id: openOrder },
    "GET /3.0/files/{}/usage": { file_id: file.id },
    "DELETE /3.0/files/{}": { file_id: spareFile.id },
    "GET /3.0/accounting/manual_entries/{}/entries/{}/files/{}": { file_id: entryFile.id },
    "DELETE /3.0/accounting/manual_entries/{}/entries/{}/files/{}": { file_id: entryFile.id },
    "GET /3.0/accounting/manual_entries/{}/files/{}": { file_id: entryFile2.id },
    "DELETE /3.0/accounting/manual_entries/{}/files/{}": { file_id: entryFile2.id },
    "PUT /4.0/purchase/bills/{}": { id: draftBill },
    "PUT /4.0/purchase/bills/{}/bookings/{}": { id: draftBill, status: "BOOKED" },
    "PUT /4.0/expenses/{}/bookings/{}": { id: expenseToBook, status: "DONE" },
    "GET /4.0/purchase/outgoing-payments/{}": { id: outgoing },
    "DELETE /4.0/purchase/outgoing-payments/{}": { id: outgoing },
  };

  const deref = (s: Json): Json => (s && s.$ref ? deref(s.$ref.split("/").slice(1).reduce((o: Json, k: string) => o[k], spec)) : s);
  const example = (schema: Json, depth = 0): Json => {
    const s = deref(schema);
    if (!s || depth > 6) return null;
    if (s.example !== undefined && typeof s.example !== "object") return s.example;
    if (s.allOf) return Object.assign({}, ...s.allOf.map((x: Json) => example(x, depth + 1)));
    if (s.oneOf || s.anyOf) return example((s.oneOf ?? s.anyOf)[0], depth + 1);
    if (s.type === "array" || s.items) return [example(s.items, depth + 1)].filter((x) => x !== null);
    if (s.type === "object" || s.properties) {
      const out: Json = {};
      for (const [k, v] of Object.entries(s.properties ?? {})) out[k] = example(v, depth + 1);
      return out;
    }
    if (s.enum) return s.enum[0];
    if (s.type === "integer" || s.type === "number") return 1;
    if (s.type === "boolean") return false;
    if (s.format === "date") return "2026-10-15";
    if (s.format === "date-time") return "2026-10-15T09:00:00+00:00";
    return "Sweep";
  };
  const REF_IDS: Record<string, unknown> = {
    contact_id: contact,
    supplier_id: contact,
    contact_partner_id: contact,
    contact_sub_id: null,
    main_contact_id: contact,
    article_id: article,
    unit_id: null,
    tax_id: salesTax,
    tax_income_id: salesTax,
    tax_expense_id: null,
    country_id: 1,
    salutation_id: null,
    title_id: null,
    titel_id: null,
    project_id: null,
    pr_project_id: null,
    bank_account_id: ids.bank_account_id,
    sender_bank_account_id: ids.bank_account_id,
    account_id: revenueAccount,
    booking_account_id: expenseAccount,
    expense_account_id: expenseAccount,
    debit_account_id: expenseAccount,
    credit_account_id: bankLedger,
    tax_account_id: null,
    client_service_id: null,
    language_id: 1,
    currency_id: ids.currency_id,
    user_id: 1,
    owner_id: 1,
    contact_branch_ids: null,
    contact_group_ids: null,
    stock_id: null,
    stock_place_id: null,
    pr_package_id: null,
    pr_milestone_id: null,
    payment_type_id: null,
    purchase_order_id: null,
    kb_terms_of_payment_template_id: null,
    kb_payment_template_id: null,
    default_tax_income_id: null,
    default_tax_expense_id: null,
    pr_parent_milestone_id: null,
    sub_contact_id: null,
    communication_kind_id: null,
    parent_id: null,
    id: undefined,
  };
  const TEXT: Record<string, string> = {
    iban: "CH9300762011623852957",
    receiver_iban: "CH9300762011623852957",
    recipient_email: "sweep@example.com",
    mail: "sweep@example.com",
    email: "sweep@example.com",
    url: "https://example.com",
    currency_code: "CHF",
    currency: "CHF",
    country_code: "CH",
    ahv_number: "756.1234.5678.97",
    nr: "",
    document_nr: "",
    document_no: "",
    intern_code: "",
    birthday: "1990-01-01",
    date_of_birth: "1990-01-01",
  };
  const fill = (v: Json, key = ""): Json => {
    if (Array.isArray(v)) return v.map((x) => fill(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, k)]).filter(([, x]) => x !== undefined));
    if (key in REF_IDS) return REF_IDS[key];
    if (key in TEXT) return TEXT[key];
    if (typeof v === "string" && /^(amount|unit_price|charge|sale_price|purchase_price|value|discount_in_percent)$/.test(key)) return "10";
    return v;
  };

  const order = (m: string) => ({ GET: 0, POST: 1, PUT: 2, PATCH: 2, DELETE: 3 })[m] ?? 4;
  const ops = Object.entries(spec.paths as Record<string, Json>)
    .flatMap(([path, item]) =>
      Object.keys(item)
        .filter((m) => ["get", "post", "put", "patch", "delete"].includes(m))
        .map((m) => ({ method: m.toUpperCase(), path, op: item[m] })),
    )
    .sort((a, b) => order(a.method) - order(b.method));

  const results: SweepResult[] = [];
  for (const { method, path, op } of ops) {
    const key = `${method} ${path.replace(/\{\w+\}/g, "{}")}`;
    const params = { ...ids, ...override[key] };
    const segment = /\/(kb_position_\w+)/.exec(path)?.[1];
    const url = path.replace(/\{(\w+)\}/g, (_, name: string) => {
      if (name === "position_id" && segment) return String(positionIds[segment]);
      if (name === "id" && path.startsWith("/4.0/expenses")) return String(params.id ?? expense);
      if (name === "id" && path.startsWith("/4.0/purchase/outgoing")) return String(params.id ?? outgoing);
      if (name === "id") return String(params.id ?? bookedBill);
      if (name === "payment_id" && path.startsWith("/4.0/")) return String(path.endsWith("/cancel") ? paymentToCancel : bankingPayment);
      return String(params[name] ?? 1);
    });
    const query = new URLSearchParams();
    for (const p of [...(spec.paths[path].parameters ?? []), ...(op.parameters ?? [])].map(deref)) {
      if (p.in !== "query" || !p.required) continue;
      query.set(p.name, p.name === "bill_id" ? String(bookedBill) : p.name === "date" ? "2026-10-15" : p.name === "businessYear" ? "2026" : p.name === "document_no" ? "SWEEP-1" : String(example(p.schema) ?? "1"));
    }
    const content = op.requestBody ? (deref(op.requestBody).content ?? {}) : {};
    let init: RequestInit = { method };
    if (content["application/json"]) {
      let body = fill(example(content["application/json"].schema));
      if (path.endsWith("/search")) body = [{ field: "id", value: "1", criteria: ">=" }];
      if (key === "POST /3.0/accounting/manual_entries" || key === "PUT /3.0/accounting/manual_entries/{}") body = { ...body, type: "manual_single_entry" };
      if (key === "PUT /4.0/purchase/outgoing-payments") body = { ...body, payment_id: outgoing };
      if (key === "POST /4.0/purchase/outgoing-payments") body = { ...body, bill_id: bookedBill, amount: 1 };
      if (key === "POST /4.0/banking/payments") body = { ...body, account_id: uuidFor(4, Number(ids.bank_account_id)), purchase_reference: undefined };
      if (key === "PUT /4.0/banking/payments/{}") body = { ...body, purchase_reference: undefined };
      if (key === "POST /3.0/currencies") body = { name: "SEK", round_factor: 0.01 };
      if (key.includes("/2.0/contact_relation") && !key.endsWith("/search")) body = { ...body, contact_id: contact, contact_sub_id: otherContact };
      if (key === "POST /2.0/country/{}") body = { ...body, iso3166_alpha2: "XK", name_short: "XK", name: "Kosovo" };
      if (key === "POST /2.0/country") body = { ...body, iso3166_alpha2: "XS", name_short: "XS", name: "Sweepland" };
      if (/\/4\.0\/(purchase\/bills|expenses)/.test(key) && body && "attachment_ids" in body) body = { ...body, attachment_ids: [uuidFor(12, file.id)] };
      if (key === "PUT /4.0/purchase/bills/{}") body = { ...body, line_items: [{ position: 0, title: "Edited", amount: 120, booking_account_id: expenseAccount }], discounts: [] };
      if (key === "POST /3.0/accounting/calendar_years") body = { ...body, year: "2032" };
      if (key === "POST /2.0/kb_offer/{}/order" || key === "POST /2.0/kb_offer/{}/invoice" || key.startsWith("POST /2.0/kb_order/{}/")) body = {};
      if (key === "POST /2.0/kb_order/{}/repetition") body = { start: "2026-12-01", repetition: { type: "weekly", interval: 2, weekdays: ["monday"] } };
      if (key === "POST /4.0/payroll/employees") body = { ...body, ahv_number: "756.1234.5678.97" };
      if (key === "PATCH /4.0/payroll/employees/{}") body = { ...body, ahv_number: "756.1234.5678.97" };
      init = { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } };
    } else if (content["multipart/form-data"]) {
      const form = new FormData();
      const field = Object.keys(deref(content["multipart/form-data"].schema).properties ?? { file: 1 })[0];
      form.append(field, new File([new TextEncoder().encode("%PDF-1.4 sweep")], "sweep.pdf", { type: "application/pdf" }));
      init = { method, body: form };
    }
    const target = `${url}${query.size ? `?${query}` : ""}`;
    const res = await dispatchCompat(async () => ctx, new Request(`https://batzio.test/api/compat${target}`, init), url);
    const type = res.headers.get("content-type") ?? "";
    const text = type.includes("json") ? await res.text() : "";
    const parsed = text ? JSON.parse(text) : null;
    results.push({ key, status: res.status, message: res.status >= 400 ? parsed?.message : undefined, body: parsed });
  }
  return results;
}

export const routeCount = () => compatRoutes().length;
