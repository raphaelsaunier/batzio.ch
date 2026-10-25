import { z } from "zod";
import { operations, type Operation } from "@/lib/api/operations";
import { toMajorUnits } from "@/lib/api/units";
import { today } from "@/lib/format";
import { interpolate } from "@/lib/i18n";
import { bestMatch, categorize } from "@/lib/quick/autopilot";
import { getResource, listResources } from "@/lib/resources/registry";
import type { ResourceDef, Row } from "@/lib/resources/types";
import { accountIdByNumber } from "@/lib/server/accounting";
import { importStatements, parseCamt, parseCsv } from "@/lib/server/banking";
import { audit } from "@/lib/server/audit";
import { inviteMember } from "@/lib/server/control";
import { createRecord, deleteRecord, getRecord, listParamsFrom, listRecords, refLabels, runAction, toApi, updateRecord } from "@/lib/server/crud";
import { assertCan, canCtx, type Ctx } from "@/lib/server/ctx";
import { AppError } from "@/lib/server/errors";
import { attachFile, readFile } from "@/lib/server/files";
import { renderNumber } from "@/lib/server/numbering";
import { getSettings, saveSettings } from "@/lib/server/settings";
import type { Role } from "@/lib/permissions";
import { importTable } from "./importers";
import { detectTable, readTables, type Cell, type Table, type TableKind } from "./tables";

/**
 * Every capability the agents have. The same tools back the MCP endpoint
 * (external agents) and Batzi, the in-app assistant. Schemas are static —
 * permissions are checked when a tool runs — so the tool list never changes
 * within a conversation.
 */
export interface AgentTool {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  readOnly?: boolean;
  /** Batzi must get an explicit yes from the user before running it. */
  confirm?: boolean | ((input: Record<string, unknown>) => boolean);
  run(ctx: Ctx, input: Record<string, unknown>): Promise<unknown>;
}

const RESOURCE = z.string().describe("Resource name, e.g. invoices, contacts, bills, expenses, journal_entries, timesheets. See list_resource_types.");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");

function resourceOrThrow(ctx: Ctx, name: string, level: "read" | "write" = "read"): ResourceDef {
  const res = getResource(String(name));
  if (!res) throw new AppError("not_found", "Unknown resource “{name}”. Call list_resource_types to see all resources.", undefined, { name: String(name) });
  assertCan(ctx, res.area, level);
  return res;
}

function describeResource(res: ResourceDef) {
  return {
    name: res.name,
    label: res.labelPlural,
    description: res.description,
    writable: !res.readOnly,
    can_create: !res.readOnly && !res.noCreate,
    fields: res.fields
      .filter((f) => !["created_by", "updated_by"].includes(f.name))
      .map((f) => ({
        name: f.name,
        type: f.type,
        label: f.label,
        ...(f.required ? { required: true } : {}),
        ...(f.readOnly ? { read_only: true } : {}),
        ...(f.ref ? { references: f.ref } : {}),
        ...(f.options ? { values: f.options.map((o) => o.value) } : {}),
        ...(f.description ? { description: f.description } : {}),
      })),
    children: (res.children ?? []).map((c) => ({
      name: c.name,
      fields: c.fields.filter((f) => !f.readOnly && !f.hidden).map((f) => ({ name: f.name, type: f.type, ...(f.ref ? { references: f.ref } : {}), ...(f.options ? { values: f.options.map((o) => o.value) } : {}) })),
    })),
    actions: (res.actions ?? []).map((a) => ({
      name: a.name,
      description: a.description,
      ...(a.confirm ? { needs_confirmation: true } : {}),
      input: (a.input ?? []).map((f) => ({ name: f.name, type: f.type, required: !!f.required, ...(f.ref ? { references: f.ref } : {}) })),
    })),
  };
}

const taxIdByCode = async (ctx: Ctx, code: string | null | undefined) =>
  code ? await ctx.db.value<number>("SELECT id FROM taxes WHERE upper(code) = upper(?)", code) : null;

async function findContact(ctx: Ctx, name: string, opts: { iban?: string | null } = {}) {
  const contacts = await ctx.db.all<{ id: number; type: string; name_1: string; name_2: string | null; iban: string | null }>(
    "SELECT id, type, name_1, name_2, iban FROM contacts WHERE archived_at IS NULL",
  );
  const iban = opts.iban?.replace(/\s+/g, "").toUpperCase();
  if (iban) {
    const byIban = contacts.find((c) => c.iban?.replace(/\s+/g, "").toUpperCase() === iban);
    if (byIban) return byIban;
  }
  return bestMatch(name, contacts, (c) => (c.type === "person" ? `${c.name_2 ?? ""} ${c.name_1}` : c.name_1), 0.7);
}

const SUPPLIER = z
  .object({
    contact_id: z.number().int().optional(),
    name: z.string().optional().describe("Supplier name as printed on the bill"),
    iban: z.string().optional(),
    street: z.string().optional(),
    house_number: z.string().optional(),
    postcode: z.string().optional(),
    city: z.string().optional(),
    country_code: z.string().optional(),
    vat_number: z.string().optional(),
    email: z.string().optional(),
  })
  .describe("Who the bill is from. Matched by contact_id, IBAN or name; created as a supplier when unknown.");

async function ensureSupplier(ctx: Ctx, s: z.infer<typeof SUPPLIER>): Promise<{ id: number; created: boolean }> {
  if (s.contact_id) return { id: s.contact_id, created: false };
  if (!s.name) throw new AppError("validation", "The supplier name is required.");
  const hit = await findContact(ctx, s.name, { iban: s.iban });
  if (hit) return { id: hit.id, created: false };
  const contact = await createRecord(ctx, getResource("contacts")!, {
    type: "company",
    name_1: s.name,
    street: s.street,
    house_number: s.house_number,
    postcode: s.postcode,
    city: s.city,
    country_code: s.country_code ?? "CH",
    vat_number: s.vat_number,
    email: s.email,
    iban: s.iban?.replace(/\s+/g, ""),
    is_customer: false,
    is_supplier: true,
  });
  return { id: Number(contact.id), created: true };
}

const accountOrCategory = async (ctx: Ctx, account: string | undefined, text: string) => {
  if (account) return { accountId: await accountIdByNumber(ctx, account), taxCode: undefined as string | null | undefined };
  const cat = categorize(text);
  return { accountId: await accountIdByNumber(ctx, cat.accountNumber), taxCode: cat.taxCode };
};

const COMPANY_SETTINGS = z
  .object({
    name: z.string(),
    legal_form: z.string().describe("e.g. AG, GmbH, Einzelunternehmen, Sàrl"),
    street: z.string(),
    house_number: z.string(),
    postcode: z.string(),
    city: z.string(),
    country_code: z.string(),
    phone: z.string(),
    email: z.string(),
    website: z.string(),
    vat_number: z.string().describe("CHE-123.456.789 MWST"),
    commercial_register: z.string(),
    language: z.enum(["de", "fr", "it", "en"]).describe("Default language of documents"),
    accent_color: z.string().describe("Hex colour used on documents, e.g. #2f5f8f"),
  })
  .partial();

const ACCOUNTING_SETTINGS = z
  .object({
    vat_registered: z.boolean(),
    vat_method: z.enum(["effective", "net_tax_rate"]),
    vat_period: z.enum(["quarterly", "semiannual", "monthly"]),
    chf_rounding: z.number().describe("0.05 rounds totals to 5 centimes, 0.01 disables rounding"),
    default_payment_days: z.number().int(),
    quote_validity_days: z.number().int(),
    reminder_fees: z.array(z.number()).length(3).describe("Fees in CHF for reminder levels 1–3"),
    reminder_days: z.number().int().describe("Days between reminder levels"),
  })
  .partial();

const TEXTS_SETTINGS = z
  .object({
    quote_header: z.string(),
    quote_footer: z.string(),
    order_header: z.string(),
    invoice_header: z.string(),
    invoice_footer: z.string(),
    credit_note_header: z.string(),
    delivery_header: z.string(),
    reminder_header: z.string(),
  })
  .partial()
  .describe("Intro/closing texts printed on documents. Empty string = use the built-in text in the document's language.");

const IMPORT_KINDS = ["contacts", "suppliers", "items", "opening_balances", "bank_lines"] as const;

function tableFromObjects(rows: Record<string, unknown>[]): Table {
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return { sheet: "rows", headers, rows: rows.map((r) => headers.map((h) => (r[h] === undefined || r[h] === null ? null : (r[h] as Cell)))) };
}

function opTool(op: Operation): AgentTool {
  const shape: Record<string, z.ZodType> = {};
  if (op.query) for (const [k, v] of Object.entries(op.query.shape)) if (k !== "format") shape[k] = v as z.ZodType;
  if (op.body instanceof z.ZodObject) for (const [k, v] of Object.entries(op.body.shape)) shape[k] = v as z.ZodType;
  if (op.rawBody && op.id === "importBankStatement") {
    shape.content = z.string().describe("File content (camt XML or CSV)");
    shape.auto_book = z.boolean().optional();
  }
  return {
    name: op.mcp!.name,
    title: op.summary,
    description: op.mcp!.description,
    input: z.object(shape),
    readOnly: op.level === "read",
    run: async (ctx, args) => {
      assertCan(ctx, op.area, op.level);
      const query: Record<string, unknown> = {};
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        if (op.query && k in op.query.shape) query[k] = v === undefined ? undefined : String(v);
        else body[k] = v;
      }
      const result = await op.run(ctx, { query, body, params: {}, request: new Request("https://agent.internal/", { headers: { "x-mcp": "1" } }) });
      if (result instanceof Response) return { status: result.status, contentType: result.headers.get("content-type"), note: "Binary content is available through the REST API." };
      return op.rawUnits ? result : toMajorUnits(result);
    },
  };
}

const TOOLS: AgentTool[] = [
  {
    name: "list_resource_types",
    title: "List resource types",
    description: "Lists all record types with their fields, nested collections and workflow actions. Pass `resource` for the full definition of one type.",
    input: z.object({ resource: RESOURCE.optional() }),
    readOnly: true,
    run: async (ctx, { resource }) =>
      resource
        ? describeResource(resourceOrThrow(ctx, String(resource)))
        : listResources()
            .filter((r) => canCtx(ctx, r.area, "read"))
            .map((r) => ({ name: r.name, label: r.labelPlural, description: r.description, actions: (r.actions ?? []).map((a) => a.name) })),
  },
  {
    name: "search_records",
    title: "Search records",
    description:
      'Lists records of a resource with optional full-text query and filters. Filters are equality on field names (e.g. {"status":"open"}) or ranges with _gte/_lte suffixes (e.g. {"date_gte":"2026-01-01"}). Returns readable labels for referenced records.',
    input: z.object({
      resource: RESOURCE,
      query: z.string().optional().describe("Free-text search"),
      filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      sort: z.string().optional(),
      dir: z.enum(["asc", "desc"]).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    readOnly: true,
    run: async (ctx, { resource, query, filters, sort, dir, limit, offset }) => {
      const res = resourceOrThrow(ctx, String(resource));
      const params = listParamsFrom({
        ...Object.fromEntries(Object.entries((filters as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v)])),
        ...(query ? { q: String(query) } : {}),
        ...(sort ? { sort: String(sort) } : {}),
        ...(dir ? { dir: String(dir) } : {}),
        limit: String(limit ?? 25),
        offset: String(offset ?? 0),
      });
      const page = await listRecords(ctx, res, params);
      const labels = await refLabels(ctx, res, page.rows, getResource);
      return { total: page.total, offset: page.offset, data: page.rows.map((r) => toApi(res, r)), labels };
    },
  },
  {
    name: "get_record",
    title: "Get record",
    description: "Fetches one record including nested positions/lines.",
    input: z.object({ resource: RESOURCE, id: z.number().int() }),
    readOnly: true,
    run: async (ctx, { resource, id }) => {
      const res = resourceOrThrow(ctx, String(resource));
      const record = await getRecord(ctx, res, Number(id));
      return { data: toApi(res, record), labels: await refLabels(ctx, res, [record], getResource) };
    },
  },
  {
    name: "create_record",
    title: "Create record",
    description:
      "Creates a record. Use list_resource_types with `resource` to see the fields. Documents take a `positions` array, bills and journal entries a `lines` array. Amounts are decimal CHF.",
    input: z.object({ resource: RESOURCE, data: z.record(z.string(), z.unknown()).describe("Field values") }),
    run: async (ctx, { resource, data }) => {
      const res = resourceOrThrow(ctx, String(resource), "write");
      return toApi(res, await createRecord(ctx, res, data as Row));
    },
  },
  {
    name: "update_record",
    title: "Update record",
    description: "Updates fields of a record. Nested arrays (positions/lines) replace the existing ones entirely.",
    input: z.object({ resource: RESOURCE, id: z.number().int(), data: z.record(z.string(), z.unknown()) }),
    run: async (ctx, { resource, id, data }) => {
      const res = resourceOrThrow(ctx, String(resource), "write");
      return toApi(res, await updateRecord(ctx, res, Number(id), data as Row));
    },
  },
  {
    name: "delete_record",
    title: "Delete record",
    description: "Deletes (or archives, for contacts/items/projects) a record. Issued documents cannot be deleted.",
    input: z.object({ resource: RESOURCE, id: z.number().int() }),
    confirm: true,
    run: async (ctx, { resource, id }) => {
      await deleteRecord(ctx, resourceOrThrow(ctx, String(resource), "write"), Number(id));
      return { deleted: true, id };
    },
  },
  {
    name: "run_record_action",
    title: "Run workflow action",
    description:
      "Runs a workflow action on a record, e.g. invoices: issue, mark_sent, record_payment {date, amount}, create_reminder, create_credit_note, cancel; quotes: accept, create_invoice; bills: book, record_payment; payslips: finalize. See list_resource_types for each resource's actions.",
    input: z.object({ resource: RESOURCE, id: z.number().int(), action: z.string(), input: z.record(z.string(), z.unknown()).optional() }),
    confirm: ({ resource, action }) => {
      const def = getResource(String(resource))?.actions?.find((a) => a.name === action);
      return !!def && (!!def.confirm || def.variant === "destructive");
    },
    run: async (ctx, { resource, id, action, input }) => {
      const res = resourceOrThrow(ctx, String(resource));
      const result = await runAction(ctx, res, Number(id), String(action), (input ?? {}) as Row);
      const record = await getRecord(ctx, res, Number(id)).catch(() => null);
      return { message: result.message && interpolate(result.message, result.vars), redirect: result.redirect, data: result.data, record: record ? toApi(res, record) : null };
    },
  },
  {
    name: "create_invoice",
    title: "Create invoice",
    description:
      "Creates a customer invoice. Identify the customer by `contact_id` or by `customer` name. Optionally issues it right away (books it and assigns the QR reference).",
    input: z.object({
      contact_id: z.number().int().optional(),
      customer: z.string().optional().describe("Customer name to look up if contact_id is not known"),
      title: z.string().optional(),
      date: DATE.optional(),
      positions: z
        .array(
          z.object({
            text: z.string(),
            quantity: z.number().default(1),
            unit_price: z.number().describe("Price per unit in CHF"),
            unit: z.string().optional(),
            item_id: z.number().int().optional(),
            vat_code: z.string().optional().describe("VAT code such as UN81, UR26, UEX (default UN81)"),
          }),
        )
        .min(1),
      prices_include_vat: z.boolean().optional(),
      issue: z.boolean().optional(),
    }),
    run: async (ctx, raw) => {
      const input = raw as { contact_id?: number; customer?: string; title?: string; date?: string; positions: { text: string; quantity: number; unit_price: number; unit?: string; item_id?: number; vat_code?: string }[]; prices_include_vat?: boolean; issue?: boolean };
      const res = getResource("invoices")!;
      let contactId = input.contact_id ?? null;
      if (!contactId && input.customer) {
        const hit = await findContact(ctx, input.customer);
        if (!hit) throw new AppError("validation", "No contact matches “{name}”.", undefined, { name: input.customer });
        contactId = hit.id;
      }
      const taxes = new Map((await ctx.db.all<{ id: number; code: string }>("SELECT id, code FROM taxes")).map((t) => [t.code.toUpperCase(), t.id]));
      const invoice = await createRecord(ctx, res, {
        contact_id: contactId,
        title: input.title,
        date: input.date ?? today(),
        vat_mode: input.prices_include_vat ? "incl" : undefined,
        positions: input.positions.map((p) => ({
          type: p.item_id ? "item" : "custom",
          item_id: p.item_id,
          text: p.text,
          quantity: p.quantity,
          unit_price: p.unit_price,
          unit_name: p.unit,
          tax_id: taxes.get((p.vat_code ?? "UN81").toUpperCase()) ?? null,
        })),
      });
      if (input.issue) await runAction(ctx, res, Number(invoice.id), "issue");
      return toApi(res, await getRecord(ctx, res, Number(invoice.id)));
    },
  },
  {
    name: "create_bill",
    title: "Record a supplier bill",
    description:
      "Records an invoice the company received (from a scan, PDF or email). The supplier is matched by IBAN or name and created if unknown. Amounts are gross (incl. VAT) unless amounts_include_vat is false. Without `account`, the expense account and VAT are guessed from the text. Pass `file_id` to attach the original. Set `book` to post it to the ledger right away.",
    input: z.object({
      supplier: SUPPLIER,
      title: z.string().optional(),
      vendor_invoice_number: z.string().optional(),
      date: DATE.optional(),
      due_date: DATE.optional(),
      currency: z.string().optional().describe("ISO code, default CHF"),
      iban: z.string().optional().describe("IBAN or QR-IBAN to pay to"),
      reference: z.string().optional().describe("QR reference (27 digits) or creditor reference (RF…)"),
      payment_message: z.string().optional(),
      amounts_include_vat: z.boolean().optional(),
      lines: z
        .array(
          z.object({
            text: z.string(),
            amount: z.number().describe("CHF"),
            vat_code: z.string().optional().describe("Input VAT code such as VI81, VI26, VI38; omit for no VAT"),
            account: z.string().optional().describe("Expense account number, e.g. 6510"),
          }),
        )
        .min(1),
      file_id: z.number().int().optional(),
      book: z.boolean().optional(),
    }),
    run: async (ctx, raw) => {
      const input = raw as { supplier: z.infer<typeof SUPPLIER>; title?: string; vendor_invoice_number?: string; date?: string; due_date?: string; currency?: string; iban?: string; reference?: string; payment_message?: string; amounts_include_vat?: boolean; lines: { text: string; amount: number; vat_code?: string; account?: string }[]; file_id?: number; book?: boolean };
      const res = resourceOrThrow(ctx, "bills", "write");
      const supplier = await ensureSupplier(ctx, { ...input.supplier, iban: input.supplier.iban ?? input.iban });
      const lines = [];
      for (const l of input.lines) {
        const guess = await accountOrCategory(ctx, l.account, `${input.supplier.name ?? ""} ${l.text}`);
        lines.push({ text: l.text, amount: l.amount, tax_id: await taxIdByCode(ctx, l.vat_code ?? guess.taxCode), account_id: guess.accountId });
      }
      const bill = await createRecord(ctx, res, {
        contact_id: supplier.id,
        title: input.title ?? input.lines[0].text,
        vendor_nr: input.vendor_invoice_number,
        date: input.date ?? today(),
        due_date: input.due_date,
        currency_code: input.currency ?? "CHF",
        vat_mode: input.amounts_include_vat === false ? "excl" : "incl",
        iban: input.iban?.replace(/\s+/g, ""),
        qr_reference: input.reference?.replace(/\s+/g, ""),
        payment_message: input.payment_message,
        file_id: input.file_id,
        lines,
      });
      if (input.file_id) await attachFile(ctx, input.file_id, "bills", Number(bill.id));
      if (input.book) await runAction(ctx, res, Number(bill.id), "book");
      return { supplier_created: supplier.created, bill: toApi(res, await getRecord(ctx, res, Number(bill.id))) };
    },
  },
  {
    name: "create_expense",
    title: "Record a receipt",
    description:
      "Records a receipt that was already paid (card, cash, private money): train tickets, lunches, a cable. Without `account`, the expense account and VAT are guessed from the title. `paid_from`: bank (1020, default), cash (1000), or card/private (2210 other short-term liabilities — credit card statement or money owed to whoever paid).",
    input: z.object({
      title: z.string(),
      date: DATE.optional(),
      amount: z.number().describe("Gross amount in CHF"),
      vat_code: z.string().optional(),
      account: z.string().optional(),
      paid_from: z.enum(["bank", "cash", "card", "private"]).optional(),
      supplier: z.string().optional(),
      file_id: z.number().int().optional(),
      book: z.boolean().optional().describe("Default true"),
    }),
    run: async (ctx, raw) => {
      const input = raw as { title: string; date?: string; amount: number; vat_code?: string; account?: string; paid_from?: "bank" | "cash" | "card" | "private"; supplier?: string; file_id?: number; book?: boolean };
      const res = resourceOrThrow(ctx, "expenses", "write");
      const guess = await accountOrCategory(ctx, input.account, `${input.supplier ?? ""} ${input.title}`);
      const from = { bank: "1020", cash: "1000", card: "2210", private: "2210" }[input.paid_from ?? "bank"];
      const supplier = input.supplier ? await findContact(ctx, input.supplier) : null;
      const expense = await createRecord(ctx, res, {
        title: input.title,
        date: input.date ?? today(),
        amount: input.amount,
        tax_id: await taxIdByCode(ctx, input.vat_code ?? guess.taxCode),
        account_id: guess.accountId,
        payment_account_id: await accountIdByNumber(ctx, from),
        contact_id: supplier?.id ?? null,
        file_id: input.file_id,
      });
      if (input.file_id) await attachFile(ctx, input.file_id, "expenses", Number(expense.id));
      if (input.book !== false) await runAction(ctx, res, Number(expense.id), "book");
      return toApi(res, await getRecord(ctx, res, Number(expense.id)));
    },
  },
  {
    name: "create_journal_entry",
    title: "Create journal entry",
    description:
      "Books a manual journal entry using account numbers (Swiss SME chart, e.g. 1020 bank, 6000 rent). Amounts are gross; with a VAT code the VAT is split automatically.",
    input: z.object({
      date: DATE,
      description: z.string(),
      lines: z
        .array(
          z.object({
            debit_account: z.string().describe("Debit account number"),
            credit_account: z.string().describe("Credit account number"),
            amount: z.number().positive(),
            vat_code: z.string().optional(),
            text: z.string().optional(),
          }),
        )
        .min(1),
    }),
    run: async (ctx, raw) => {
      const input = raw as { date: string; description: string; lines: { debit_account: string; credit_account: string; amount: number; vat_code?: string; text?: string }[] };
      const accounts = new Map((await ctx.db.all<{ id: number; number: string }>("SELECT id, number FROM accounts")).map((a) => [a.number, a.id]));
      const lookup = (n: string) => {
        const id = accounts.get(n);
        if (!id) throw new AppError("validation", "Unknown account {number}.", undefined, { number: n });
        return id;
      };
      const res = resourceOrThrow(ctx, "journal_entries", "write");
      const lines = [];
      for (const l of input.lines) {
        lines.push({ debit_account_id: lookup(l.debit_account), credit_account_id: lookup(l.credit_account), amount: l.amount, tax_id: await taxIdByCode(ctx, l.vat_code), description: l.text });
      }
      return toApi(res, await createRecord(ctx, res, { date: input.date, description: input.description, lines }));
    },
  },
  {
    name: "log_time",
    title: "Log time",
    description: "Records a time entry on a project (by id or name).",
    input: z.object({
      project_id: z.number().int().optional(),
      project: z.string().optional(),
      date: DATE.optional(),
      hours: z.number().positive(),
      description: z.string(),
      activity: z.string().optional().describe("Activity name, e.g. Consulting or Development"),
      billable: z.boolean().optional(),
    }),
    run: async (ctx, raw) => {
      const input = raw as { project_id?: number; project?: string; date?: string; hours: number; description: string; activity?: string; billable?: boolean };
      let projectId = input.project_id ?? null;
      if (!projectId && input.project) {
        const projects = await ctx.db.all<{ id: number; name: string }>("SELECT id, name FROM projects WHERE archived_at IS NULL");
        const hit = bestMatch(input.project, projects, (p) => p.name, 0.5);
        if (!hit) throw new AppError("validation", "Could not identify project “{name}”; pass project_id.", undefined, { name: input.project });
        projectId = hit.id;
      }
      const activityId = input.activity ? await ctx.db.value<number>("SELECT id FROM business_activities WHERE name LIKE ? LIMIT 1", `%${input.activity}%`) : null;
      const res = resourceOrThrow(ctx, "timesheets", "write");
      return toApi(
        res,
        await createRecord(ctx, res, {
          project_id: projectId,
          date: input.date ?? today(),
          duration_minutes: Math.round(input.hours * 60),
          description: input.description,
          activity_id: activityId,
          is_billable: input.billable ?? true,
        }),
      );
    },
  },
  {
    name: "import_rows",
    title: "Import rows",
    description:
      "Imports many records at once from rows you extracted (e.g. from a screenshot or PDF of a list). kind: contacts|suppliers (keys: name, first_name, last_name, email, phone, street, postcode, city, country, vat, website, iban), items (item_name, price, cost, sku, unit, description), opening_balances (account, balance — natural sign, e.g. assets and liabilities both positive), bank_lines (date, amount — negative for money out, text, reference). Duplicates are skipped.",
    input: z.object({
      kind: z.enum(IMPORT_KINDS),
      rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).min(1).max(500),
      date: DATE.optional().describe("Opening balance date (default 1 January of this year)"),
      bank_account_id: z.number().int().optional(),
    }),
    run: async (ctx, raw) => {
      const input = raw as { kind: (typeof IMPORT_KINDS)[number]; rows: Record<string, Cell>[]; date?: string; bank_account_id?: number };
      const table = tableFromObjects(input.rows);
      const kind: TableKind = input.kind === "suppliers" ? "contacts" : input.kind;
      return importTable(ctx, table, kind, Object.fromEntries(table.headers.map((h, i) => [h, i])), { supplier: input.kind === "suppliers", date: input.date, bankAccountId: input.bank_account_id });
    },
  },
  {
    name: "import_spreadsheet",
    title: "Import a spreadsheet file",
    description:
      "Reads an uploaded CSV/XLSX file (by file_id), detects what it contains (contacts, products, opening balances, bank lines) and imports it. Pass `kind` to override detection, `preview: true` to only report what would be imported.",
    input: z.object({
      file_id: z.number().int(),
      kind: z.enum(IMPORT_KINDS).optional(),
      sheet: z.string().optional(),
      preview: z.boolean().optional(),
      date: DATE.optional(),
    }),
    run: async (ctx, raw) => {
      const input = raw as { file_id: number; kind?: (typeof IMPORT_KINDS)[number]; sheet?: string; preview?: boolean; date?: string };
      const { row, bytes } = await readFile(ctx, input.file_id);
      const tables = readTables(bytes, row.name, row.mime_type);
      const table = tables.find((t) => !input.sheet || t.sheet === input.sheet) ?? tables[0];
      if (!table) throw new AppError("validation", "This file contains no readable table.");
      const detected = detectTable(table);
      const kind: TableKind = input.kind ? (input.kind === "suppliers" ? "contacts" : input.kind) : detected.kind;
      if (input.preview || kind === "unknown") {
        return { sheets: tables.map((t) => t.sheet), sheet: table.sheet, headers: table.headers, sample: table.rows.slice(0, 5), detected: detected.kind, confidence: detected.confidence, mapping: detected.mapping };
      }
      return importTable(ctx, table, kind, detected.mapping, { supplier: input.kind === "suppliers", date: input.date });
    },
  },
  {
    name: "import_bank_file",
    title: "Import a bank statement file",
    description: "Imports an uploaded camt.053/054 XML or CSV statement (by file_id), matches payments to invoices and bills, and books exact QR-reference matches.",
    input: z.object({ file_id: z.number().int(), bank_account_id: z.number().int().optional() }),
    run: async (ctx, { file_id, bank_account_id }) => {
      assertCan(ctx, "banking", "write");
      const { bytes } = await readFile(ctx, Number(file_id));
      const text = new TextDecoder().decode(bytes);
      const statements = /^\s*</.test(text.replace(/^\uFEFF/, "")) ? await parseCamt(text) : await parseCsv(text);
      return importStatements(ctx, statements, { bankAccountId: bank_account_id ? Number(bank_account_id) : null, autoBook: true });
    },
  },
  {
    name: "attach_file",
    title: "Attach a file to a record",
    description: "Links an uploaded file (receipt, contract, scan) to any record, e.g. a bill, expense, contact or project.",
    input: z.object({ file_id: z.number().int(), resource: RESOURCE, id: z.number().int() }),
    run: async (ctx, { file_id, resource, id }) => {
      const res = resourceOrThrow(ctx, String(resource), "write");
      await getRecord(ctx, res, Number(id));
      await attachFile(ctx, Number(file_id), res.name, Number(id));
      if (res.fields.some((f) => f.name === "file_id")) await updateRecord(ctx, res, Number(id), { file_id: Number(file_id) }).catch(() => undefined);
      return { attached: true };
    },
  },
  {
    name: "get_settings",
    title: "Read settings",
    description: "Reads company details (company), accounting rules (accounting) or document texts (texts).",
    input: z.object({ group: z.enum(["company", "accounting", "texts"]) }),
    readOnly: true,
    run: async (ctx, { group }) => {
      assertCan(ctx, "settings", "read");
      return getSettings(ctx, group as "company");
    },
  },
  {
    name: "update_company_settings",
    title: "Update company details",
    description: "Changes company details printed on documents: name, address, VAT number, contact data, document language and accent colour. Only pass what changes.",
    input: z.object({ values: COMPANY_SETTINGS }),
    run: async (ctx, { values }) => {
      assertCan(ctx, "settings", "write");
      const next = await saveSettings(ctx, "company", values as object);
      await audit(ctx, { action: "update", resource: "settings", summary: "Company details changed", changes: values as Row });
      return next;
    },
  },
  {
    name: "update_accounting_settings",
    title: "Update accounting rules",
    description: "Changes VAT registration and method, VAT period, rounding, payment terms, quote validity and reminder fees. Only pass what changes.",
    input: z.object({ values: ACCOUNTING_SETTINGS }),
    confirm: (input) => {
      const v = (input.values ?? {}) as Record<string, unknown>;
      return "vat_registered" in v || "vat_method" in v;
    },
    run: async (ctx, { values }) => {
      assertCan(ctx, "settings", "write");
      const next = await saveSettings(ctx, "accounting", values as object);
      await audit(ctx, { action: "update", resource: "settings", summary: "Accounting rules changed", changes: values as Row });
      return next;
    },
  },
  {
    name: "update_document_texts",
    title: "Update document texts",
    description: "Changes the intro and closing texts on quotes, orders, invoices, credit notes, delivery notes and reminders.",
    input: z.object({ values: TEXTS_SETTINGS }),
    run: async (ctx, { values }) => {
      assertCan(ctx, "settings", "write");
      const next = await saveSettings(ctx, "texts", values as object);
      await audit(ctx, { action: "update", resource: "settings", summary: "Document texts changed" });
      return next;
    },
  },
  {
    name: "set_company_logo",
    title: "Set company logo",
    description: "Uses an uploaded image (PNG or JPEG, by file_id) as the logo on all documents.",
    input: z.object({ file_id: z.number().int() }),
    run: async (ctx, { file_id }) => {
      assertCan(ctx, "settings", "write");
      const { row } = await readFile(ctx, Number(file_id));
      if (!/^image\/(png|jpe?g)$/.test(row.mime_type ?? "")) throw new AppError("validation", "The logo must be a PNG or JPEG image.");
      await attachFile(ctx, row.id, "settings", 0);
      await saveSettings(ctx, "company", { logo_file_id: row.id });
      await audit(ctx, { action: "update", resource: "settings", summary: `Logo set to ${row.name}` });
      return { logo_file_id: row.id };
    },
  },
  {
    name: "list_number_formats",
    title: "List number formats",
    description: "Shows how invoices, quotes, bills etc. are numbered and which number comes next.",
    input: z.object({}),
    readOnly: true,
    run: async (ctx) => {
      assertCan(ctx, "settings", "read");
      const rows = await ctx.db.all<{ key: string; format: string; next_value: number; reset: string }>("SELECT key, format, next_value, reset FROM sequences ORDER BY key");
      return rows.map((r) => ({ ...r, next: renderNumber(r.format, r.next_value) }));
    },
  },
  {
    name: "set_number_format",
    title: "Change a number format",
    description:
      "Changes the numbering of a document type. Placeholders: {YYYY} year, {YY}, {MM}, and a run of # for the zero-padded counter, e.g. RE-{YYYY}-{####}. `next_value` sets the next counter (e.g. to continue numbering from a previous tool).",
    input: z.object({ sequence: z.string().describe("invoice, quote, order, delivery, credit_note, bill, expense, contact, item, project, employee, journal, purchase_order"), format: z.string().optional(), next_value: z.number().int().positive().optional(), reset: z.enum(["never", "yearly"]).optional() }),
    run: async (ctx, raw) => {
      const input = raw as { sequence: string; format?: string; next_value?: number; reset?: "never" | "yearly" };
      assertCan(ctx, "settings", "write");
      if (input.format && !/\{#+\}/.test(input.format)) throw new AppError("validation", "The format needs a counter such as {####}.");
      const current = await ctx.db.first<{ format: string; next_value: number; reset: string }>("SELECT format, next_value, reset FROM sequences WHERE key = ?", input.sequence);
      if (!current) throw new AppError("not_found", "Unknown number sequence “{name}”.", undefined, { name: input.sequence });
      await ctx.db.run(
        "UPDATE sequences SET format = ?, next_value = ?, reset = ? WHERE key = ?",
        input.format ?? current.format,
        input.next_value ?? current.next_value,
        input.reset ?? current.reset,
        input.sequence,
      );
      await audit(ctx, { action: "update", resource: "sequences", summary: `Number format ${input.sequence} changed`, changes: input as unknown as Row });
      return { sequence: input.sequence, next: renderNumber(input.format ?? current.format, input.next_value ?? current.next_value) };
    },
  },
  {
    name: "invite_member",
    title: "Invite a team member",
    description: "Gives someone access to this company. Roles: owner, admin, accountant (books & reports), member (day-to-day work), viewer (read only). Returns an invitation link when the person has no account yet.",
    input: z.object({ email: z.string().email(), role: z.enum(["owner", "admin", "accountant", "member", "viewer"]) }),
    confirm: true,
    run: async (ctx, { email, role }) => {
      assertCan(ctx, "settings", "write");
      if (!ctx.control) throw new AppError("internal", "Team management is not available here.");
      if (role === "owner" && ctx.role !== "owner") throw new AppError("forbidden", "Only owners can add owners.");
      const r = await inviteMember(ctx.control, { tenantId: ctx.tenant.id, email: String(email), role: role as Role, invitedBy: ctx.user?.id ?? ctx.actor.id ?? "agent" });
      await audit(ctx, { action: "invite", resource: "members", summary: `Invited ${email} as ${role}` });
      return r.added ? { added: true } : { invited: true, signup_path: `/signup?invite=${r.token}` };
    },
  },
];

let cached: AgentTool[] | null = null;

/** All tools, in a stable order (stable prefix = warm prompt cache). */
export function toolkit(): AgentTool[] {
  cached ??= [...TOOLS, ...operations.filter((op) => op.mcp).map(opTool)];
  return cached;
}

export const findTool = (name: string) => toolkit().find((t) => t.name === name) ?? null;

export function needsConfirmation(tool: AgentTool, input: Record<string, unknown>): boolean {
  return typeof tool.confirm === "function" ? tool.confirm(input) : !!tool.confirm;
}

/** Validates input against the tool's schema, then runs it. */
export async function runTool(ctx: Ctx, tool: AgentTool, raw: unknown): Promise<unknown> {
  const parsed = tool.input.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError("validation", "Invalid input for {tool}: {path} {problem}", undefined, { tool: tool.name, path: issue?.path.join(".") ?? "", problem: issue?.message ?? "" });
  }
  return tool.run(ctx, parsed.data as Record<string, unknown>);
}

/** JSON Schema for a tool's input (Claude tool definitions). */
export function inputJsonSchema(tool: AgentTool): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

