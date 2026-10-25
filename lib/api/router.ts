import { interpolate } from "@/lib/i18n";
import { getResource, listResources } from "@/lib/resources/registry";
import type { ResourceDef, Row } from "@/lib/resources/types";
import { assertCan, type Ctx } from "@/lib/server/ctx";
import {
  createRecord,
  deleteRecord,
  getRecord,
  listAll,
  listParamsFrom,
  listRecords,
  restoreRecord,
  runAction,
  toApi,
  updateRecord,
} from "@/lib/server/crud";
import { AppError, toAppError } from "@/lib/server/errors";
import { resourceSheet } from "@/lib/server/exports";
import { pdfResponse } from "@/lib/server/pdf/base";
import { renderDocumentPdf, renderReminderPdf, type ReminderRow } from "@/lib/server/pdf/document";
import { renderPayslipPdf } from "@/lib/server/pdf/reports";
import type { DocumentRow } from "@/lib/server/sales";
import { buildXlsx, XLSX_MIME } from "@/lib/server/xlsx";
import { apiContext } from "./context";
import { buildOpenApi } from "./openapi";
import { matchOperation } from "./operations";
import { toMajorUnits } from "./units";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Tenant",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS, ...extra },
  });
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

async function readBody(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (request.method === "GET" || request.method === "DELETE") return {};
  if (type.includes("application/json")) {
    const text = await request.text();
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new AppError("validation", "The request body is not valid JSON.");
    }
  }
  if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) return null;
  return request.text();
}

const PDF_DOCUMENTS = new Set(["quotes", "orders", "deliveries", "invoices", "credit_notes", "purchase_orders"]);

export async function resourcePdf(ctx: Ctx, res: ResourceDef, id: number): Promise<Response> {
  if (PDF_DOCUMENTS.has(res.name)) {
    const doc = (await getRecord(ctx, res, id)) as unknown as DocumentRow;
    return pdfResponse(await renderDocumentPdf(ctx, doc), `${doc.nr ?? `${res.singular}-${id}`}.pdf`);
  }
  if (res.name === "reminders") {
    const reminder = (await getRecord(ctx, res, id)) as unknown as ReminderRow;
    const doc = (await getRecord(ctx, getResource("invoices")!, reminder.document_id)) as unknown as DocumentRow;
    return pdfResponse(await renderReminderPdf(ctx, reminder, doc), `reminder-${doc.nr ?? id}-${reminder.level}.pdf`);
  }
  if (res.name === "payslips") {
    const slip = await getRecord(ctx, res, id);
    const employee = await getRecord(ctx, getResource("employees")!, Number(slip.employee_id));
    return pdfResponse(await renderPayslipPdf(ctx, { employee, slip }), `payslip-${slip.year}-${String(slip.month).padStart(2, "0")}-${employee.lastname}.pdf`);
  }
  throw new AppError("not_found", `${res.labelPlural} have no PDF representation.`);
}

function apiIndex(origin: string) {
  return {
    name: "Batzio API",
    version: "1",
    documentation: `${origin}/docs/api`,
    openapi: `${origin}/api/v1/openapi.json`,
    mcp: `${origin}/api/mcp`,
    authentication: "Authorization: Bearer <API key> (create keys under Settings → API & MCP)",
    resources: listResources().map((r) => ({ name: r.name, label: r.labelPlural, href: `${origin}/api/v1/${r.name}` })),
  };
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new AppError("not_found", "Invalid id.");
  return id;
}

/** Entry point for /api/v1/*. */
export async function handleApi(request: Request, segments: string[]): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  try {
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (segments.length === 0) return json(apiIndex(url.origin));
    if (segments.length === 1 && segments[0] === "openapi.json") return json(buildOpenApi(url.origin));

    const matched = matchOperation(method, segments);
    if (matched) {
      const ctx = await apiContext(request);
      assertCan(ctx, matched.op.area, matched.op.level);
      const query = Object.fromEntries(url.searchParams.entries());
      if (matched.op.query) {
        const parsed = matched.op.query.safeParse(query);
        if (!parsed.success) throw new AppError("validation", parsed.error.issues[0]?.message ?? "Invalid query.");
      }
      let body: unknown = matched.op.rawBody?.contentType === "multipart/form-data" ? null : await readBody(request);
      if (matched.op.body) {
        const parsed = matched.op.body.safeParse(body);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          throw new AppError("validation", `${issue?.path.join(".") || "body"}: ${issue?.message}`);
        }
        body = parsed.data;
      }
      const result = await matched.op.run(ctx, { query, body, params: matched.params, request });
      return result instanceof Response ? withCors(result) : json({ data: matched.op.rawUnits ? result : toMajorUnits(result) });
    }

    const [name, rawId, action] = segments;
    const res = getResource(name);
    if (!res || segments.length > 3) throw new AppError("not_found", `No endpoint ${method} /api/v1/${segments.join("/")}.`);
    const ctx = await apiContext(request);

    if (segments.length === 1) {
      if (method === "GET") {
        const params = listParamsFrom(url.searchParams);
        if (url.searchParams.get("format") === "xlsx") {
          const rows = await listAll(ctx, res, params);
          const bytes = buildXlsx([await resourceSheet(ctx, res, rows)]);
          return withCors(
            new Response(bytes as BodyInit, {
              headers: {
                "Content-Type": XLSX_MIME,
                "Content-Disposition": `attachment; filename="${res.name}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
              },
            }),
          );
        }
        const page = await listRecords(ctx, res, params);
        return json({
          data: page.rows.map((r) => toApi(res, r)),
          meta: { total: page.total, limit: page.limit, offset: page.offset },
        });
      }
      if (method === "POST") {
        const record = await createRecord(ctx, res, ((await readBody(request)) ?? {}) as Row);
        return json({ data: toApi(res, record) }, 201);
      }
    } else {
      const id = parseId(rawId);
      if (segments.length === 2) {
        if (method === "GET") return json({ data: toApi(res, await getRecord(ctx, res, id)) });
        if (method === "PATCH" || method === "PUT") {
          const record = await updateRecord(ctx, res, id, ((await readBody(request)) ?? {}) as Row);
          return json({ data: toApi(res, record) });
        }
        if (method === "DELETE") {
          await deleteRecord(ctx, res, id);
          return json({ data: { id, deleted: !res.softDelete, archived: !!res.softDelete } });
        }
      } else if (action === "pdf" && method === "GET") {
        return withCors(await resourcePdf(ctx, res, id));
      } else if (action === "restore" && method === "POST") {
        return json({ data: toApi(res, await restoreRecord(ctx, res, id)) });
      } else if (method === "POST") {
        const result = await runAction(ctx, res, id, action, ((await readBody(request)) ?? {}) as Row);
        const record = await getRecord(ctx, res, id).catch(() => null);
        return json({ data: { message: result.message && interpolate(result.message, result.vars), redirect: result.redirect, data: result.data, record: record ? toApi(res, record) : null } });
      }
    }
    throw new AppError("not_found", `Method ${method} is not supported on /api/v1/${segments.join("/")}.`);
  } catch (error) {
    const e = toAppError(error);
    return json(e.toJSON(), e.status, e.code === "unauthorized" ? { "WWW-Authenticate": 'Bearer realm="batzio"' } : {});
  }
}
