import { z } from "zod";
import { today } from "@batzio/core/format";
import type { Area } from "@batzio/core/permissions";
import { accountLedger, balanceSheet, incomeStatement, trialBalance, vatReport } from "../accounting";
import { verifyAuditLog } from "../audit";
import { exportPain001, importStatements, parseCamt, parseCsv } from "../banking";
import { assertCan, type Ctx } from "../ctx";
import { getDashboard, openItems } from "../dashboard";
import { AppError } from "../errors";
import { ledgerSheet, reportSheet, trialBalanceSheet, vatSheets } from "../exports";
import { fileResponse, storeFile } from "../files";
import { runPayroll } from "../payroll";
import { pdfResponse } from "../pdf/base";
import { renderLedgerPdf, renderReportPdf, renderTrialBalancePdf, renderVatPdf } from "../pdf/reports";
import { remindOverdue, runRecurring } from "../sales";
import { getSettings, saveSettings } from "../settings";
import { buildXlsx, XLSX_MIME, type Sheet } from "../xlsx";

/**
 * Non-CRUD API operations. Each one is exposed as a REST endpoint, documented
 * in OpenAPI and (when `mcp` is set) offered as an MCP tool.
 */
export interface OperationInput {
  query: Record<string, unknown>;
  body: unknown;
  params: Record<string, string>;
  request: Request;
}

export interface Operation {
  id: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  tag: string;
  summary: string;
  description?: string;
  /** Checked before `run`; operations without one check permissions themselves. */
  area?: Area;
  level?: "read" | "write";
  query?: z.ZodObject;
  body?: z.ZodType;
  rawBody?: { contentType: string; description: string };
  formats?: ("json" | "xlsx" | "pdf")[];
  binaryResponse?: { contentType: string; description: string };
  mcp?: { name: string; description: string };
  /** Result already uses API units (e.g. records converted with toApi); skip report unit conversion. */
  rawUnits?: boolean;
  run(ctx: Ctx, input: OperationInput): Promise<unknown>;
}

const date = (d: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(d);
const yearStart = () => `${today().slice(0, 4)}-01-01`;
const yearEnd = () => `${today().slice(0, 4)}-12-31`;
const format = z.enum(["json", "xlsx", "pdf"]).optional().describe("Response format (default json)");

function xlsxResponse(sheets: Sheet[], filename: string): Response {
  return new Response(buildXlsx(sheets) as BodyInit, {
    headers: { "Content-Type": XLSX_MIME, "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" },
  });
}

async function withFormat(
  fmt: unknown,
  data: unknown,
  xlsx: () => Sheet[] | Promise<Sheet[]>,
  pdf: () => Promise<Uint8Array>,
  filename: string,
): Promise<unknown> {
  if (fmt === "xlsx") return xlsxResponse(await xlsx(), `${filename}.xlsx`);
  if (fmt === "pdf") return pdfResponse(await pdf(), `${filename}.pdf`);
  return data;
}

export const operations: Operation[] = [
  {
    id: "getMe",
    method: "GET",
    path: "/me",
    tag: "Company",
    summary: "Current user, company and permissions",
    area: "contacts",
    level: "read",
    mcp: { name: "whoami", description: "Returns the company, user, role and API scope this connection acts as." },
    rawUnits: true,
    run: async (ctx) => ({ tenant: ctx.tenant, user: ctx.user, role: ctx.role, scope: ctx.scope, actor: ctx.actor.name }),
  },
  {
    id: "getDashboard",
    method: "GET",
    path: "/reports/dashboard",
    tag: "Reports",
    summary: "Key figures: revenue, profit, cash, receivables, payables, VAT",
    area: "accounting",
    level: "read",
    mcp: { name: "get_dashboard", description: "Key business figures: year-to-date revenue, expenses and profit, cash, open receivables (incl. overdue), payables, unbilled time, current VAT liability and 12-month trend." },
    run: (ctx) => getDashboard(ctx),
  },
  {
    id: "getBalanceSheet",
    method: "GET",
    path: "/reports/balance-sheet",
    tag: "Reports",
    summary: "Balance sheet as of a date",
    area: "accounting",
    level: "read",
    formats: ["json", "xlsx", "pdf"],
    query: z.object({ date: date("Reporting date (default today)").optional(), format }),
    mcp: { name: "get_balance_sheet", description: "Balance sheet (assets, liabilities, equity) as of a date." },
    run: async (ctx, { query }) => {
      const r = await balanceSheet(ctx, String(query.date ?? today()));
      return withFormat(query.format, r, () => [reportSheet(r, ctx.tenant.name)], () => renderReportPdf(ctx, r), "balance-sheet");
    },
  },
  {
    id: "getIncomeStatement",
    method: "GET",
    path: "/reports/income-statement",
    tag: "Reports",
    summary: "Staged income statement for a period",
    area: "accounting",
    level: "read",
    formats: ["json", "xlsx", "pdf"],
    query: z.object({ from: date("Start (default 1 Jan)").optional(), to: date("End (default 31 Dec)").optional(), format }),
    mcp: { name: "get_income_statement", description: "Income statement (profit and loss) with gross profit, EBITDA, EBIT and net result for a period." },
    run: async (ctx, { query }) => {
      const r = await incomeStatement(ctx, String(query.from ?? yearStart()), String(query.to ?? yearEnd()));
      return withFormat(query.format, r, () => [reportSheet(r, ctx.tenant.name)], () => renderReportPdf(ctx, r), "income-statement");
    },
  },
  {
    id: "getTrialBalance",
    method: "GET",
    path: "/reports/trial-balance",
    tag: "Reports",
    summary: "Trial balance with opening, movements and closing per account",
    area: "accounting",
    level: "read",
    formats: ["json", "xlsx", "pdf"],
    query: z.object({ from: date("Start").optional(), to: date("End").optional(), format }),
    mcp: { name: "get_trial_balance", description: "Trial balance per account: opening balance, debit, credit and balance for a period." },
    run: async (ctx, { query }) => {
      const r = await trialBalance(ctx, String(query.from ?? yearStart()), String(query.to ?? yearEnd()));
      return withFormat(query.format, r, () => [trialBalanceSheet(r, ctx.tenant.name)], () => renderTrialBalancePdf(ctx, r), "trial-balance");
    },
  },
  {
    id: "getAccountLedger",
    method: "GET",
    path: "/reports/ledger",
    tag: "Reports",
    summary: "Account ledger with running balance",
    area: "accounting",
    level: "read",
    formats: ["json", "xlsx", "pdf"],
    query: z.object({
      account_id: z.coerce.number().int().optional().describe("Account id"),
      account_number: z.string().optional().describe("Account number, e.g. 1020"),
      from: date("Start").optional(),
      to: date("End").optional(),
      format,
    }),
    mcp: { name: "get_account_ledger", description: "All postings of one ledger account (by id or number, e.g. 1020) with running balance for a period." },
    run: async (ctx, { query }) => {
      let id = query.account_id ? Number(query.account_id) : null;
      if (!id && query.account_number) id = await ctx.db.value<number>("SELECT id FROM accounts WHERE number = ?", String(query.account_number));
      if (!id) throw new AppError("validation", "Provide account_id or account_number.");
      const r = await accountLedger(ctx, id, String(query.from ?? yearStart()), String(query.to ?? yearEnd()));
      return withFormat(query.format, r, () => [ledgerSheet(r, ctx.tenant.name)], () => renderLedgerPdf(ctx, r), `ledger-${r.account.number}`);
    },
  },
  {
    id: "getVatReport",
    method: "GET",
    path: "/reports/vat",
    tag: "Reports",
    summary: "VAT return figures (ESTV form digits) for a period",
    area: "accounting",
    level: "read",
    formats: ["json", "xlsx", "pdf"],
    query: z.object({ from: date("Start").optional(), to: date("End").optional(), format }),
    mcp: { name: "get_vat_report", description: "Swiss VAT return figures (effective method) by ESTV form digit and VAT code for a period." },
    run: async (ctx, { query }) => {
      const r = await vatReport(ctx, String(query.from ?? yearStart()), String(query.to ?? yearEnd()));
      return withFormat(query.format, r, () => vatSheets(r, ctx.tenant.name), () => renderVatPdf(ctx, r), "vat-return");
    },
  },
  {
    id: "getOpenItems",
    method: "GET",
    path: "/reports/open-items",
    tag: "Reports",
    summary: "Open receivables or payables with ageing",
    area: "sales",
    level: "read",
    query: z.object({ type: z.enum(["receivables", "payables"]).default("receivables"), date: date("Ageing date").optional() }),
    mcp: { name: "get_open_items", description: "Open customer invoices (receivables) or supplier bills (payables) with days overdue and ageing buckets." },
    run: async (ctx, { query }) => {
      const type = query.type === "payables" ? "payables" : "receivables";
      assertCan(ctx, type === "payables" ? "purchases" : "sales", "read");
      return openItems(ctx, type, String(query.date ?? today()));
    },
  },
  {
    id: "importBankStatement",
    method: "POST",
    path: "/banking/import",
    tag: "Banking",
    summary: "Import a camt.053/054 or CSV bank statement",
    description: "Send the file content as request body. Transactions are de-duplicated by bank reference and matched to open invoices and payments.",
    area: "banking",
    level: "write",
    rawBody: { contentType: "application/xml", description: "camt.052/053/054 XML or CSV (date;amount;text;reference)" },
    query: z.object({
      bank_account_id: z.coerce.number().int().optional().describe("Target bank account (default: matched by IBAN)"),
      auto_book: z.enum(["true", "false"]).optional().describe("Book exact QR-reference matches automatically"),
    }),
    mcp: { name: "import_bank_statement", description: "Imports bank statement content (camt.053/054 XML or CSV) and matches payments to invoices. Pass the file content as `content`." },
    rawUnits: true,
    run: async (ctx, { query, body }) => {
      const text = typeof body === "string" ? body : String((body as { content?: string })?.content ?? "");
      if (!text.trim()) throw new AppError("validation", "The statement is empty.");
      const statements = /^\s*</.test(text) ? await parseCamt(text) : await parseCsv(text);
      return importStatements(ctx, statements, {
        bankAccountId: query.bank_account_id ? Number(query.bank_account_id) : null,
        autoBook: query.auto_book === "true" || (body as { auto_book?: boolean })?.auto_book === true,
      });
    },
  },
  {
    id: "exportPain001",
    method: "POST",
    path: "/banking/pain001",
    tag: "Banking",
    summary: "Export open payments as ISO 20022 pain.001.001.09",
    area: "banking",
    level: "write",
    body: z.object({
      bank_account_id: z.number().int().describe("Debtor bank account"),
      payment_ids: z.array(z.number().int()).optional().describe("Limit to these outgoing payments"),
    }),
    binaryResponse: { contentType: "application/xml", description: "pain.001 credit transfer file" },
    mcp: { name: "export_payment_file", description: "Creates a pain.001 XML payment file for all open outgoing payments of a bank account (marks them exported)." },
    run: async (ctx, { body, request }) => {
      const b = body as { bank_account_id: number; payment_ids?: number[] };
      const r = await exportPain001(ctx, b.bank_account_id, b.payment_ids);
      if (request.headers.get("x-mcp")) return r;
      return new Response(r.xml, { headers: { "Content-Type": "application/xml", "Content-Disposition": `attachment; filename="${r.filename}"` } });
    },
  },
  {
    id: "runPayroll",
    method: "POST",
    path: "/payroll/run",
    tag: "Payroll",
    summary: "Create draft payslips for a month",
    area: "payroll",
    level: "write",
    body: z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) }),
    mcp: { name: "run_payroll", description: "Creates draft payslips for all active employees for a month." },
    run: (ctx, { body }) => {
      const b = body as { year: number; month: number };
      return runPayroll(ctx, b.year, b.month);
    },
  },
  {
    id: "runRecurringBilling",
    method: "POST",
    path: "/sales/recurring/run",
    tag: "Sales",
    summary: "Generate due invoices from recurring orders",
    area: "sales",
    level: "write",
    mcp: { name: "run_recurring_billing", description: "Creates all invoices that are due from recurring sales orders." },
    run: async (ctx) => ({ invoice_ids: await runRecurring(ctx) }),
  },
  {
    id: "remindOverdue",
    method: "POST",
    path: "/sales/reminders/run",
    tag: "Sales",
    summary: "Create reminders for all overdue invoices",
    area: "sales",
    level: "write",
    mcp: { name: "remind_overdue_invoices", description: "Creates the next dunning level for every overdue invoice." },
    run: async (ctx) => ({ created: await remindOverdue(ctx) }),
  },
  {
    id: "uploadFile",
    method: "POST",
    path: "/files/upload",
    tag: "Files",
    summary: "Upload a file (multipart/form-data: file, ref_type, ref_id, description)",
    area: "files",
    level: "write",
    rawBody: { contentType: "multipart/form-data", description: "Fields: file (binary), ref_type, ref_id, description" },
    rawUnits: true,
    run: async (ctx, { request }) => {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new AppError("validation", "Missing file.", { file: "Required" });
      return storeFile(
        ctx,
        { name: file.name, type: file.type, bytes: await file.arrayBuffer() },
        { type: (form.get("ref_type") as string) || null, id: Number(form.get("ref_id")) || null, description: (form.get("description") as string) || null },
      );
    },
  },
  {
    id: "downloadFile",
    method: "GET",
    path: "/files/{id}/download",
    tag: "Files",
    summary: "Download a stored file",
    area: "files",
    level: "read",
    query: z.object({ inline: z.enum(["0", "1"]).optional().describe("1 = display in the browser instead of downloading") }),
    binaryResponse: { contentType: "application/octet-stream", description: "File content" },
    run: (ctx, { params, query }) => fileResponse(ctx, Number(params.id), query.inline === "1"),
  },
  {
    id: "verifyAuditLog",
    method: "GET",
    path: "/audit/verify",
    tag: "Audit",
    summary: "Verify the hash chain of the audit log",
    area: "audit",
    level: "read",
    mcp: { name: "verify_audit_log", description: "Recomputes the tamper-evident hash chain of the audit log and reports the first broken entry, if any." },
    rawUnits: true,
    run: (ctx) => verifyAuditLog(ctx),
  },
  {
    id: "listInbox",
    method: "GET",
    path: "/inbox",
    tag: "Inbox & agent",
    summary: "List inbox items (dropped files, emails, uploads)",
    area: "files",
    level: "read",
    query: z.object({ status: z.string().optional().describe("Comma-separated: new, processing, done, needs_you, failed") }),
    rawUnits: true,
    run: async (ctx, { query }) => {
      const { listInbox } = await import("../agent/inbox");
      const status = query.status ? String(query.status).split(",") : undefined;
      return listInbox(ctx, { status: status as never });
    },
  },
  {
    id: "uploadToInbox",
    method: "POST",
    path: "/inbox/files",
    tag: "Inbox & agent",
    summary: "Drop files into the inbox: statements and spreadsheets are imported, bills and receipts read by Batzi",
    area: "files",
    level: "write",
    rawBody: { contentType: "multipart/form-data", description: "One or more `files` fields; optional `note` with instructions for Batzi" },
    rawUnits: true,
    run: async (ctx, { request }) => {
      const { dropFiles, processInboxItem } = await import("../agent/inbox");
      const { getEnv } = await import("../env");
      const form = await request.formData();
      const files = [];
      for (const v of form.getAll("files")) if (typeof v !== "string" && v.size) files.push({ name: v.name, type: v.type, bytes: await v.arrayBuffer() });
      if (!files.length) throw new AppError("validation", "No files received.", { files: "Required" });
      const outcomes = await dropFiles(ctx, files.slice(0, 20), "api");
      const apiKey = getEnv().ANTHROPIC_API_KEY ?? null;
      const processed = [];
      for (const o of outcomes.filter((x) => !x.handled)) processed.push(await processInboxItem(ctx, o.inboxId, { apiKey, locale: "en" }));
      return { files: outcomes, processed };
    },
  },
  {
    id: "inboundEmail",
    method: "POST",
    path: "/inbox/email",
    tag: "Inbox & agent",
    summary: "Deliver a raw email (RFC 822) to the company inbox",
    description: "For mail systems that cannot use the company address. The API key holder is treated as the sender, so instructions in the body are followed.",
    area: "files",
    level: "write",
    rawBody: { contentType: "message/rfc822", description: "The complete MIME message" },
    rawUnits: true,
    run: async (ctx, { body }) => {
      const { ingestEmail } = await import("../email/inbound");
      const { getEnv } = await import("../env");
      const { getTenantById } = await import("../control");
      const tenant = await getTenantById(ctx.control, ctx.tenant.id);
      if (!tenant || typeof body !== "string" || !body.trim()) throw new AppError("validation", "Send the raw message as the request body.");
      return ingestEmail(getEnv(), { raw: body, tenant, authenticated: true, trustedOverride: true });
    },
  },
  {
    id: "askAgent",
    method: "POST",
    path: "/agent",
    tag: "Inbox & agent",
    summary: "Ask Batzi to do something (natural language, any of EN/DE/FR/IT)",
    description: "Runs the assistant with the same tools as the app, on behalf of the API key's user. Destructive steps come back as pending confirmations; confirm them with `confirm`.",
    area: "files",
    level: "write",
    body: z.object({
      message: z.string().optional(),
      thread_id: z.string().optional().describe("Continue a conversation"),
      file_ids: z.array(z.number().int()).optional(),
      confirm: z.object({ tool_use_id: z.string(), approve: z.boolean() }).optional(),
    }),
    rawUnits: true,
    run: async (ctx, { body }) => {
      const input = body as { message?: string; thread_id?: string; file_ids?: number[]; confirm?: { tool_use_id: string; approve: boolean } };
      const { confirmToolUse, contextBlock, fileBlocks, runAgent } = await import("../agent/claude");
      const { loadThread, newThreadId, threadBelongsTo, toUiTurns } = await import("../agent/threads");
      const { getEnv } = await import("../env");
      const apiKey = getEnv().ANTHROPIC_API_KEY ?? null;
      if (!apiKey) throw new AppError("internal", "The assistant is not configured on this server (ANTHROPIC_API_KEY).");
      if (input.thread_id && !(await threadBelongsTo(ctx, input.thread_id))) throw new AppError("forbidden", "This conversation belongs to someone else.");
      const threadId = input.thread_id ?? newThreadId();
      const errors: string[] = [];
      const env = { apiKey, locale: "en" as const, emit: (e: { type: string; message?: string }) => e.type === "error" && e.message && errors.push(e.message) };
      if (input.confirm) await confirmToolUse(ctx, threadId, input.confirm.tool_use_id, input.confirm.approve, env);
      else {
        if (!input.message && !input.file_ids?.length) throw new AppError("validation", "Send a message or files.", { message: "Required" });
        const content = [contextBlock(ctx, env), ...(input.message ? [{ type: "text" as const, text: input.message }] : []), ...(await fileBlocks(ctx, apiKey, input.file_ids ?? []))];
        await runAgent(ctx, threadId, content, { kind: "user", text: input.message ?? "", via: "chat" }, env);
      }
      if (errors.length) throw new AppError("internal", errors[0]);
      const turns = toUiTurns(await loadThread(ctx, threadId));
      const last = turns.at(-1);
      return { thread_id: threadId, reply: last?.role === "assistant" ? last.text : null, tools: last?.tools ?? [], pending: (last?.tools ?? []).filter((t) => t.pending) };
    },
  },
  {
    id: "getSettings",
    method: "GET",
    path: "/settings/{key}",
    tag: "Company",
    summary: "Read company, accounting or document text settings",
    area: "settings",
    level: "read",
    rawUnits: true,
    run: (ctx, { params }) => {
      if (!["company", "accounting", "texts"].includes(params.key)) throw new AppError("not_found", "Unknown settings group.");
      return getSettings(ctx, params.key as "company");
    },
  },
  {
    id: "updateSettings",
    method: "PATCH",
    path: "/settings/{key}",
    tag: "Company",
    summary: "Update company, accounting or document text settings",
    area: "settings",
    level: "write",
    body: z.record(z.string(), z.unknown()),
    rawUnits: true,
    run: (ctx, { params, body }) => {
      if (!["company", "accounting", "texts"].includes(params.key)) throw new AppError("not_found", "Unknown settings group.");
      return saveSettings(ctx, params.key as "company", body as Record<string, never>);
    },
  },
];

/** Matches an operation path template (`/files/{id}/download`) against segments. */
export function matchOperation(method: string, segments: string[], list: Operation[] = operations): { op: Operation; params: Record<string, string> } | null {
  for (const op of list) {
    if (op.method !== method) continue;
    const parts = op.path.split("/").filter(Boolean);
    if (parts.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    parts.forEach((p, i) => {
      if (p.startsWith("{")) params[p.slice(1, -1)] = decodeURIComponent(segments[i]);
      else if (p !== segments[i]) ok = false;
    });
    if (ok) return { op, params };
  }
  return null;
}
