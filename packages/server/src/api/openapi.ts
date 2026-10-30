import { z } from "zod";
import { fieldSchema, resourceSchema } from "../resources/schema";
import { listResources, NAV_GROUPS } from "../resources/registry";
import type { FieldDef, ResourceDef } from "../resources/types";
import { accountOperations, appOperations } from "./app";
import { operations } from "./operations";

type Json = Record<string, unknown>;

const AREA_TAG: Record<string, string> = {
  contacts: "Contacts",
  sales: "Sales",
  purchases: "Purchases",
  inventory: "Inventory",
  accounting: "Accounting",
  banking: "Banking",
  projects: "Projects & time",
  payroll: "Payroll",
  files: "Files",
  settings: "Settings",
  users: "Settings",
  audit: "Audit",
};

const PDF_RESOURCES = new Set(["quotes", "orders", "deliveries", "invoices", "credit_notes", "purchase_orders", "reminders", "payslips"]);

const pascal = (s: string) => s.replace(/(^|_)([a-z])/g, (_, __, c: string) => c.toUpperCase());

function schemaOf(zodType: z.ZodType, io: "input" | "output" = "output"): Json {
  const s = z.toJSONSchema(zodType, { io, unrepresentable: "any" }) as Json;
  delete s.$schema;
  return s;
}

function tagFor(res: ResourceDef): string {
  const nav = res.nav;
  if (nav) return NAV_GROUPS.find((g) => g.id === nav.group)?.label ?? AREA_TAG[res.area];
  return AREA_TAG[res.area] ?? "Other";
}

function listParameters(res: ResourceDef): Json[] {
  const base: Json[] = [
    { name: "q", in: "query", description: "Full-text search", schema: { type: "string" } },
    { name: "sort", in: "query", description: "Field to sort by", schema: { type: "string", enum: ["id", "created_at", "updated_at", ...res.fields.filter((f) => f.sortable || f.list).map((f) => f.name)] } },
    { name: "dir", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
    { name: "limit", in: "query", description: "Page size (1–500, default 25)", schema: { type: "integer", minimum: 1, maximum: 500 } },
    { name: "offset", in: "query", schema: { type: "integer", minimum: 0 } },
    { name: "format", in: "query", description: "`xlsx` returns an Excel export of all matching rows", schema: { type: "string", enum: ["json", "xlsx"] } },
  ];
  if (res.softDelete) base.push({ name: "archived", in: "query", description: "Include or only show archived records", schema: { type: "string", enum: ["include", "only"] } });
  for (const f of res.fields.filter((x) => x.filter || x.type === "ref")) {
    base.push({ name: f.name, in: "query", description: `Filter: ${f.label} equals`, schema: { type: "string" } });
    if (["date", "money", "decimal", "int"].includes(f.type)) {
      base.push({ name: `${f.name}_gte`, in: "query", description: `${f.label} ≥`, schema: { type: "string" } });
      base.push({ name: `${f.name}_lte`, in: "query", description: `${f.label} ≤`, schema: { type: "string" } });
    }
  }
  return base;
}

const ok = (schema: Json, description = "OK"): Json => ({
  description,
  content: { "application/json": { schema: { type: "object", properties: { data: schema }, required: ["data"] } } },
});

const errors: Json = {
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "404": { $ref: "#/components/responses/NotFound" },
  "422": { $ref: "#/components/responses/ValidationError" },
};

function actionSchema(fields: FieldDef[] | undefined): Json {
  if (!fields?.length) return { type: "object", properties: {} };
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) shape[f.name] = f.required ? fieldSchema(f) : fieldSchema(f).nullable().optional();
  return schemaOf(z.object(shape), "input");
}

export function buildOpenApi(origin: string): Json {
  const paths: Json = {};
  const schemas: Json = {
    Error: {
      type: "object",
      properties: {
        error: {
          type: "object",
          properties: {
            code: { type: "string", enum: ["validation", "not_found", "unauthorized", "forbidden", "conflict", "locked", "rate_limited", "internal"] },
            message: { type: "string" },
            fields: { type: "object", additionalProperties: { type: "string" } },
          },
          required: ["code", "message"],
        },
      },
    },
    ListMeta: {
      type: "object",
      properties: { total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" } },
    },
  };

  for (const res of listResources()) {
    const name = pascal(res.singular);
    const tag = tagFor(res);
    schemas[name] = { ...schemaOf(resourceSchema(res, "output")), description: res.description };
    const base = `/${res.name}`;
    const item = `${base}/{id}`;
    const idParam = { name: "id", in: "path", required: true, schema: { type: "integer" } };

    paths[base] = {
      get: {
        operationId: `list${pascal(res.name)}`,
        tags: [tag],
        summary: `List ${res.labelPlural.toLowerCase()}`,
        description: res.description,
        parameters: listParameters(res),
        responses: {
          "200": {
            description: "Paginated list (or XLSX file with format=xlsx)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { data: { type: "array", items: { $ref: `#/components/schemas/${name}` } }, meta: { $ref: "#/components/schemas/ListMeta" } },
                },
              },
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { schema: { type: "string", format: "binary" } },
            },
          },
          ...errors,
        },
      },
    };
    if (!res.readOnly && !res.noCreate) {
      schemas[`${name}Create`] = schemaOf(resourceSchema(res, "create"), "input");
      (paths[base] as Json).post = {
        operationId: `create${name}`,
        tags: [tag],
        summary: `Create ${res.label.toLowerCase()}`,
        requestBody: { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${name}Create` } } } },
        responses: { "201": ok({ $ref: `#/components/schemas/${name}` }, "Created"), ...errors },
      };
    }
    const itemOps: Json = {
      get: {
        operationId: `get${name}`,
        tags: [tag],
        summary: `Get ${res.label.toLowerCase()}`,
        parameters: [idParam],
        responses: { "200": ok({ $ref: `#/components/schemas/${name}` }), ...errors },
      },
    };
    if (!res.readOnly) {
      schemas[`${name}Update`] = schemaOf(resourceSchema(res, "update"), "input");
      itemOps.patch = {
        operationId: `update${name}`,
        tags: [tag],
        summary: `Update ${res.label.toLowerCase()}`,
        description: res.children?.length ? `Child collections (${res.children.map((c) => c.name).join(", ")}) are replaced entirely when provided.` : undefined,
        parameters: [idParam],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: `#/components/schemas/${name}Update` } } } },
        responses: { "200": ok({ $ref: `#/components/schemas/${name}` }), "409": { $ref: "#/components/responses/Conflict" }, ...errors },
      };
      if (!res.noDelete) {
        itemOps.delete = {
          operationId: `delete${name}`,
          tags: [tag],
          summary: res.softDelete ? `Archive ${res.label.toLowerCase()}` : `Delete ${res.label.toLowerCase()}`,
          parameters: [idParam],
          responses: { "200": ok({ type: "object" }), "409": { $ref: "#/components/responses/Conflict" }, ...errors },
        };
      }
    }
    paths[item] = itemOps;

    if (PDF_RESOURCES.has(res.name)) {
      paths[`${item}/pdf`] = {
        get: {
          operationId: `get${name}Pdf`,
          tags: [tag],
          summary: `${res.label} as PDF${res.name === "invoices" ? " (with Swiss QR-bill)" : ""}`,
          parameters: [idParam],
          responses: { "200": { description: "PDF document", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } }, ...errors },
        },
      };
    }
    if (res.softDelete) {
      paths[`${item}/restore`] = {
        post: { operationId: `restore${name}`, tags: [tag], summary: `Restore archived ${res.label.toLowerCase()}`, parameters: [idParam], responses: { "200": ok({ $ref: `#/components/schemas/${name}` }), ...errors } },
      };
    }
    for (const action of res.actions ?? []) {
      if (action.name === "restore") continue;
      paths[`${item}/${action.name}`] = {
        post: {
          operationId: `${action.name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}${name}`,
          tags: [tag],
          summary: `${action.label} (${res.label.toLowerCase()})`,
          description: action.description,
          parameters: [idParam],
          requestBody: { required: false, content: { "application/json": { schema: actionSchema(action.input) } } },
          responses: {
            "200": ok({ type: "object", properties: { message: { type: "string" }, record: { $ref: `#/components/schemas/${name}` } } }),
            "409": { $ref: "#/components/responses/Conflict" },
            ...errors,
          },
        },
      };
    }
  }

  for (const op of [...operations, ...appOperations]) {
    const path = op.path;
    const params: Json[] = [];
    for (const m of path.matchAll(/\{(\w+)\}/g)) params.push({ name: m[1], in: "path", required: true, schema: { type: "string" } });
    if (op.query) {
      const q = schemaOf(op.query, "input") as { properties?: Record<string, Json>; required?: string[] };
      for (const [k, s] of Object.entries(q.properties ?? {})) {
        params.push({ name: k, in: "query", required: q.required?.includes(k) ?? false, description: (s.description as string) ?? undefined, schema: s });
      }
    }
    const responses: Json = op.binaryResponse
      ? { "200": { description: op.binaryResponse.description, content: { [op.binaryResponse.contentType]: { schema: { type: "string", format: "binary" } } } }, ...errors }
      : {
          "200": {
            description: "OK",
            content: {
              "application/json": { schema: { type: "object", properties: { data: {} } } },
              ...(op.formats?.includes("xlsx") ? { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { schema: { type: "string", format: "binary" } } } : {}),
              ...(op.formats?.includes("pdf") ? { "application/pdf": { schema: { type: "string", format: "binary" } } } : {}),
            },
          },
          ...errors,
        };
    const entry: Json = {
      operationId: op.id,
      tags: [op.tag],
      summary: op.summary,
      description: op.description,
      parameters: params.length ? params : undefined,
      responses,
    };
    if (op.body) entry.requestBody = { required: true, content: { "application/json": { schema: schemaOf(op.body, "input") } } };
    if (op.rawBody) {
      entry.requestBody = {
        required: true,
        description: op.rawBody.description,
        content: { [op.rawBody.contentType]: { schema: op.rawBody.contentType.startsWith("multipart") ? { type: "object", properties: { file: { type: "string", format: "binary" }, ref_type: { type: "string" }, ref_id: { type: "integer" }, description: { type: "string" } } } : { type: "string" } } },
      };
    }
    paths[path] = { ...((paths[path] as Json) ?? {}), [op.method.toLowerCase()]: entry };
  }

  for (const op of accountOperations) {
    const entry: Json = {
      operationId: op.id,
      tags: ["Account"],
      summary: op.summary,
      description: op.description,
      security: op.auth === "none" ? [] : undefined,
      responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { data: {} } } } } }, ...errors },
    };
    if (op.body) entry.requestBody = { required: true, content: { "application/json": { schema: schemaOf(op.body, "input") } } };
    paths[op.path] = { ...((paths[op.path] as Json) ?? {}), [op.method.toLowerCase()]: entry };
  }

  const tags = [...new Set([...listResources().map(tagFor), ...operations.map((o) => o.tag), "App", "Account"])].map((name) => ({ name }));

  return {
    openapi: "3.1.0",
    info: {
      title: "Batzio API",
      version: "1.0.0",
      description: [
        "REST API for Batzio, the Swiss business and accounting platform. Every action available in the web app is available here.",
        "",
        "**Authentication** — create an API key under *Settings → Connections* and send it as `Authorization: Bearer bz_…`. Keys are bound to one company and capped to the creator's role; read-only keys cannot write.",
        "",
        "**Conventions** — amounts are decimal numbers in major units (e.g. `1250.50`), dates are `YYYY-MM-DD`. Lists support `q`, `sort`, `dir`, `limit`, `offset`, equality filters on fields (`status=open`) and ranges (`date_gte=2026-01-01`). Add `format=xlsx` to download any list as Excel.",
        "",
        "**Nested data** — documents carry `positions`, bills and journal entries carry `lines`; send the full array to replace them.",
        "",
        "**Workflows** — state changes (issue, record payment, book, cancel…) are `POST /{resource}/{id}/{action}` endpoints. Every change is written to the tamper-evident audit log.",
        "",
        `**MCP** — AI assistants connect to \`${origin}/api/mcp\` (Streamable HTTP). Adding that address starts an OAuth sign-in; an API key works as a bearer token too.`,
      ].join("\n"),
    },
    servers: [{ url: `${origin}/api/v1` }],
    security: [{ bearerAuth: [] }],
    tags,
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Batzio API key (bz_…), or an app session token from POST /auth/login together with X-Tenant" } },
      schemas,
      responses: {
        Unauthorized: { description: "Missing or invalid API key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        Forbidden: { description: "Insufficient role or read-only key", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        NotFound: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        ValidationError: { description: "Invalid input", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        Conflict: { description: "Not allowed in the current state (e.g. editing an issued invoice)", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  };
}
