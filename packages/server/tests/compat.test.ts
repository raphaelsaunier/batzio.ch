import { existsSync, readFileSync } from "node:fs";
import Ajv from "ajv";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { compatRoutes, dispatchCompat } from "../src/compat/index";
import { idFromUuid, uuidFor } from "../src/compat/wire";
import type { Ctx } from "../src/ctx";
import { seedDemo } from "../src/seed";
import { sweep } from "./compat-sweep";
import { makeCtx } from "./helpers/tenant";

type Json = any;

async function call(ctx: Ctx, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await dispatchCompat(async () => ctx, new Request(`https://batzio.test/api/compat${path}`, init), path.split("?")[0]);
  const type = res.headers.get("content-type") ?? "";
  const text = type.includes("json") ? await res.text() : "";
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

describe("compatibility API", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
    await seedDemo(ctx);
  });

  it("routes each operation exactly once", () => {
    const keys = compatRoutes().map((r) => `${r.method} ${r.path.replace(/\{\w+\}/g, "{}")}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeGreaterThanOrEqual(310);
  });

  it("encodes integer ids as stable UUIDs", () => {
    const u = uuidFor(6, 4242)!;
    expect(u).toMatch(/^00000000-0000-8006-8000-[0-9a-f]{12}$/);
    expect(idFromUuid(u, 6)).toBe(4242);
    expect(idFromUuid("17")).toBe(17);
    expect(() => idFromUuid(u, 9)).toThrow();
  });

  it("creates, finds, edits, archives and restores contacts — unmodelled fields round-trip", async () => {
    const ch = (await call(ctx, "POST", "/2.0/country/search", [{ field: "iso3166_alpha2", value: "CH" }])).body[0].id;
    const made = await call(ctx, "POST", "/2.0/contact", {
      contact_type_id: 1,
      name_1: "Kompatibel AG",
      street_name: "Bahnhofstrasse",
      house_number: "1",
      postcode: "8001",
      city: "Zürich",
      country_id: ch,
      mail: "info@kompatibel.ch",
      fax: "+41 44 000 00 00",
      contact_group_ids: "1",
      user_id: 1,
      owner_id: 1,
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name_1: "Kompatibel AG", contact_type_id: 1, mail: "info@kompatibel.ch", address: "Bahnhofstrasse 1", country_id: ch, contact_group_ids: "1" });
    const id = made.body.id;
    expect((await call(ctx, "GET", `/2.0/contact/${id}`)).body.fax).toBe("+41 44 000 00 00");

    const found = await call(ctx, "POST", "/2.0/contact/search?order_by=name_1_desc", [{ field: "name_1", value: "kompatibel", criteria: "like" }]);
    expect(found.body.map((c: Json) => c.id)).toContain(id);

    const edited = await call(ctx, "POST", `/2.0/contact/${id}`, { name_1: "Kompatibel Holding AG" });
    expect(edited.body).toMatchObject({ name_1: "Kompatibel Holding AG", fax: "+41 44 000 00 00", city: "Zürich" });

    expect((await call(ctx, "DELETE", `/2.0/contact/${id}`)).body).toEqual({ success: true });
    expect((await call(ctx, "GET", "/2.0/contact")).body.map((c: Json) => c.id)).not.toContain(id);
    expect((await call(ctx, "GET", "/2.0/contact?show_archived=true")).body.map((c: Json) => c.id)).toContain(id);
    await call(ctx, "PATCH", `/2.0/contact/${id}/restore`);
    expect((await call(ctx, "GET", "/2.0/contact")).body.map((c: Json) => c.id)).toContain(id);
  });

  it("runs an invoice from draft to paid with positions, PDF and payments", async () => {
    const contact = (await call(ctx, "GET", "/2.0/contact?limit=1")).body[0].id;
    const tax = Number(await ctx.db.value("SELECT id FROM taxes WHERE type = 'sales' AND rate = 8.1 ORDER BY id LIMIT 1"));
    const made = await call(ctx, "POST", "/2.0/kb_invoice", {
      contact_id: contact,
      title: "Beratung",
      mwst_type: 0,
      mwst_is_net: true,
      is_valid_from: "2026-10-01",
      is_valid_to: "2026-10-31",
      positions: [{ type: "KbPositionCustom", amount: "3", unit_price: "180", tax_id: tax, text: "Consulting" }],
    });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ total_net: "540.000000", total_taxes: "43.740000", total: "583.750000", kb_item_status_id: 7 });
    expect(made.body.taxs).toEqual([{ percentage: "8.100000", value: "43.740000" }]);
    const id = made.body.id;

    const text = await call(ctx, "POST", `/2.0/kb_invoice/${id}/kb_position_text`, { text: "Thank you!" });
    expect(text.status).toBe(201);
    expect(text.body).toMatchObject({ type: "KbPositionText", text: "Thank you!" });
    const custom = (await call(ctx, "GET", `/2.0/kb_invoice/${id}/kb_position_custom`)).body;
    expect(custom).toHaveLength(1);
    // Editing one position keeps the others' ids.
    const edited = await call(ctx, "POST", `/2.0/kb_invoice/${id}/kb_position_custom/${custom[0].id}`, { amount: "4" });
    expect(edited.body).toMatchObject({ id: custom[0].id, amount: "4.000000", position_total: "720.000000" });
    expect((await call(ctx, "GET", `/2.0/kb_invoice/${id}/kb_position_text/${text.body.id}`)).body.text).toBe("Thank you!");

    expect((await call(ctx, "POST", `/2.0/kb_invoice/${id}/issue`)).body).toEqual({ success: true });
    const issued = (await call(ctx, "GET", `/2.0/kb_invoice/${id}`)).body;
    expect(issued.kb_item_status_id).toBe(8);
    expect(issued.positions).toHaveLength(2);

    const pdf = (await call(ctx, "GET", `/2.0/kb_invoice/${id}/pdf`)).body;
    expect(pdf.mime).toBe("application/pdf");
    expect(pdf.content.startsWith("JVBER")).toBe(true);

    const paid = await call(ctx, "POST", `/2.0/kb_invoice/${id}/payment`, { date: "2026-10-20", value: issued.total });
    expect(paid.status).toBe(201);
    expect(paid.body).toMatchObject({ value: issued.total, kb_invoice_id: id });
    expect((await call(ctx, "GET", `/2.0/kb_invoice/${id}`)).body.kb_item_status_id).toBe(9);

    const search = await call(ctx, "POST", "/2.0/kb_invoice/search", [{ field: "kb_item_status_id", value: "9" }]);
    expect(search.body.map((d: Json) => d.id)).toContain(id);
  });

  it("converts a quote into an order and an invoice", async () => {
    const contact = (await call(ctx, "GET", "/2.0/contact?limit=1")).body[0].id;
    const quote = (
      await call(ctx, "POST", "/2.0/kb_offer", {
        contact_id: contact,
        positions: [
          { type: "KbPositionCustom", amount: "2", unit_price: "100", text: "A" },
          { type: "KbPositionCustom", amount: "1", unit_price: "50", text: "B" },
        ],
      })
    ).body;
    await call(ctx, "POST", `/2.0/kb_offer/${quote.id}/issue`);
    await call(ctx, "POST", `/2.0/kb_offer/${quote.id}/accept`);
    expect((await call(ctx, "GET", `/2.0/kb_offer/${quote.id}`)).body.kb_item_status_id).toBe(3);
    const order = await call(ctx, "POST", `/2.0/kb_offer/${quote.id}/order`, { positions: [{ id: quote.positions[0].id, type: "KbPositionCustom", amount: 1 }] });
    expect(order.status).toBe(200);
    expect(order.body.positions).toHaveLength(1);
    expect(order.body.positions[0].amount).toBe("1.000000");
    const rep = await call(ctx, "POST", `/2.0/kb_order/${order.body.id}/repetition`, { start: "2026-11-01", repetition: { type: "monthly", interval: 3 } });
    expect(rep.body.repetition).toMatchObject({ type: "monthly", interval: 3 });
  });

  it("books supplier bills and schedules their payment (4.0)", async () => {
    const supplier = Number(await ctx.db.value("SELECT id FROM contacts ORDER BY id LIMIT 1"));
    const account = Number(await ctx.db.value("SELECT id FROM accounts WHERE number = '4400' OR type = 'expense' ORDER BY number LIMIT 1"));
    const bill = await call(ctx, "POST", "/4.0/purchase/bills", {
      supplier_id: supplier,
      contact_partner_id: supplier,
      bill_date: "2026-10-02",
      due_date: "2026-11-01",
      currency_code: "CHF",
      item_net: false,
      manual_amount: false,
      attachment_ids: [],
      address: { lastname_company: "Lieferant", type: "COMPANY" },
      line_items: [{ position: 0, title: "Material", amount: 108.1, booking_account_id: account }],
      discounts: [],
      payment: { type: "IBAN", iban: "CH9300762011623852957", execution_date: "2026-10-30", amount: 108.1, salary_payment: false },
    });
    expect(bill.status).toBe(201);
    expect(bill.body).toMatchObject({ status: "DRAFT", amount_calc: 108.1, line_items: [{ title: "Material", amount: 108.1 }] });
    const booked = await call(ctx, "PUT", `/4.0/purchase/bills/${bill.body.id}/bookings/BOOKED`);
    expect(booked.body.status).toBe("CREATED");
    const payments = await call(ctx, "GET", `/4.0/purchase/outgoing-payments?bill_id=${bill.body.id}`);
    expect(payments.body.paging.item_count).toBe(1);
    expect(payments.body.data[0]).toMatchObject({ amount: 108.1, status: "PENDING", execution_date: "2026-10-30" });
    const list = await call(ctx, "GET", "/4.0/purchase/bills?limit=5&page=1");
    expect(list.body.paging).toMatchObject({ page: 1, page_size: 5 });
  });

  it("answers errors in the original shape", async () => {
    expect(await call(ctx, "GET", "/2.0/contact/999999")).toEqual({ status: 404, body: { error_code: 404, message: "Contact not found." } });
    expect((await call(ctx, "POST", "/2.0/contact/search", [{ field: "password", value: "x" }])).status).toBe(422);
    expect((await call(ctx, "GET", "/2.0/nothing")).status).toBe(404);
    expect((await call(ctx, "PUT", "/2.0/contact")).status).toBe(405);
  });

  it("lets read-only keys read and search, but not write", async () => {
    const reader = { ...ctx, scope: "read" as const };
    expect((await call(reader, "POST", "/2.0/contact/search", [])).status).toBe(200);
    expect((await call(reader, "POST", "/2.0/contact", { contact_type_id: 1, name_1: "X", user_id: 1, owner_id: 1 })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Conformance against the reference specification. The specification itself
// is not part of the repository; put it at tmp/compat-openapi.json to run this.

const SPEC_PATHS = [new URL("../../../tmp/compat-openapi.json", import.meta.url)];
const specFile = SPEC_PATHS.find((u) => existsSync(u));

/**
 * Places where the published specification contradicts the live API it
 * describes; the compatibility API follows the live behaviour.
 */
const SPEC_ERRATA = new Set([
  // Documented as returning a contact; the endpoint returns the relation.
  "POST /2.0/contact_relation",
  // Documented as a single object; the endpoints return lists.
  "GET /4.0/banking/payments",
  "GET /4.0/purchase/outgoing-payments",
  // Documented as an integer; payment titles are text.
  "GET /2.0/kb_invoice/{}/payment",
  // The four recurrence variants differ only in prose, so every valid answer matches several of the oneOf branches.
  "GET /2.0/kb_order/{}/repetition",
  "POST /2.0/kb_order/{}/repetition",
]);

describe.skipIf(!specFile)("compatibility API conformance", () => {
  const spec = specFile ? JSON.parse(readFileSync(specFile, "utf8")) : { paths: {} };
  const norm = (method: string, path: string) => `${method.toUpperCase()} ${path.replace(/\{\w+\}/g, "{}")}`;
  const documented = Object.entries(spec.paths as Record<string, Record<string, Json>>).flatMap(([path, item]) =>
    Object.keys(item)
      .filter((m) => ["get", "post", "put", "patch", "delete"].includes(m))
      .map((m) => ({ key: norm(m, path), op: item[m] })),
  );

  it("implements every documented operation", () => {
    const ours = new Set(compatRoutes().map((r) => norm(r.method, r.path)));
    expect(documented.filter((d) => !ours.has(d.key)).map((d) => d.key)).toEqual([]);
    expect(documented.length).toBe(310);
  });

  it("answers every documented operation with a documented status and shape", async () => {
    Object.assign(env as Record<string, unknown>, { EMAIL: { send: async () => ({ messageId: "test" }) }, EMAIL_FROM: "documents@batzio.test" });
    const ctx = await makeCtx();
    await seedDemo(ctx);
    const results = await sweep(ctx, spec);
    expect(results).toHaveLength(310);

    const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
    // OpenAPI 3.0 writes exclusive bounds as booleans next to minimum/maximum.
    const modern = (v: Json): Json => {
      if (Array.isArray(v)) return v.map(modern);
      if (!v || typeof v !== "object") return v;
      const out: Json = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, modern(x)]));
      // The published schemas rarely mark optional values as nullable, while
      // the live API sends null for "not set": accept null, but keep requiring the key.
      if (typeof out.type === "string") out.nullable = true;
      // In OpenAPI 3.0 a nullable enum admits null; JSON Schema wants it listed.
      if (Array.isArray(out.enum) && out.nullable && !out.enum.includes(null)) out.enum = [...out.enum, null];
      for (const [flag, bound] of [["exclusiveMinimum", "minimum"], ["exclusiveMaximum", "maximum"]]) {
        if (typeof out[flag] !== "boolean") continue;
        if (out[flag] && typeof out[bound] === "number") out[flag] = out[bound];
        else delete out[flag];
        if (typeof out[flag] === "number") delete out[bound];
      }
      return out;
    };
    const components = modern(spec.components);
    const failures: string[] = [];
    for (const r of results) {
      const op = documented.find((d) => d.key === r.key)!.op;
      const codes = Object.keys(op.responses ?? {}).filter((c) => c.startsWith("2"));
      if (!codes.includes(String(r.status))) {
        failures.push(`${r.key}: HTTP ${r.status}${r.message ? ` (${r.message})` : ""}, documented ${codes.join("/")}`);
        continue;
      }
      const schema = op.responses[String(r.status)]?.content?.["application/json"]?.schema;
      if (!schema || r.body === null || SPEC_ERRATA.has(r.key)) continue;
      const validate = ajv.compile({ ...modern(schema), components });
      if (!validate(r.body)) failures.push(`${r.key}: ${ajv.errorsText(validate.errors, { separator: "; " }).slice(0, 300)}`);
    }
    expect(failures).toEqual([]);
  });
});
