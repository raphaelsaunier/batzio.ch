import { describe, expect, it } from "vitest";
import { appOperations, targetFor } from "../src/api/app";
import type { Operation } from "../src/api/operations";
import type { Ctx } from "../src/ctx";
import { seedDemo } from "../src/seed";
import { makeCtx } from "./helpers/tenant";

const op = (id: string): Operation => appOperations.find((o) => o.id === id)!;

async function call(ctx: Ctx, id: string, input: { query?: Record<string, unknown>; params?: Record<string, string>; body?: unknown; locale?: string } = {}) {
  const request = new Request(`https://batzio.test/api/v1/x?locale=${input.locale ?? "de"}`);
  return op(id).run(ctx, { query: input.query ?? {}, params: input.params ?? {}, body: input.body ?? {}, request }) as Promise<any>;
}

describe("app API", () => {
  it("maps web paths to app destinations", () => {
    expect(targetFor("/acme", "acme")).toEqual({ kind: "today" });
    expect(targetFor("/acme/invoices", "acme")).toEqual({ kind: "resource", resource: "invoices" });
    expect(targetFor("/acme/invoices/12", "acme")).toEqual({ kind: "resource", resource: "invoices", id: 12 });
    expect(targetFor("/acme/bills/new?file_id=3", "acme")).toEqual({ kind: "resource", resource: "bills", create: true });
    expect(targetFor("/acme/reports/vat", "acme")).toEqual({ kind: "reports", report: "vat" });
    expect(targetFor("/acme/settings/users", "acme")).toEqual({ kind: "settings", section: "team" });
    expect(targetFor("/api/v1/files/9/download?tenant=acme", "acme")).toEqual({ kind: "file", id: 9 });
  });

  it("bootstraps translated navigation, resources, glossary and reports", async () => {
    const ctx = await makeCtx();
    const boot = await call(ctx, "appBootstrap", { query: { mode: "simple" } });
    expect(boot.locale).toBe("de");
    expect(boot.navigation[0].items[0]).toMatchObject({ title: "Heute", target: { kind: "today" } });
    const invoices = boot.resources.find((r: { name: string }) => r.name === "invoices");
    expect(invoices.canCreate).toBe(true);
    expect(invoices.pdf).toBe(true);
    expect(invoices.fields.length).toBeGreaterThan(5);
    expect(boot.glossary.vat.term).toBe("MWST");
    expect(boot.reports.map((r: { id: string }) => r.id)).toContain("balance-sheet");
    const withTabs = boot.navigation.flatMap((s: { items: { tabs: unknown[] }[] }) => s.items).find((i: { tabs: unknown[] }) => i.tabs.length > 1);
    expect(withTabs).toBeTruthy();

    const accountant = await call(ctx, "appBootstrap", { query: { mode: "accountant" }, locale: "fr" });
    expect(accountant.mode).toBe("accountant");
    expect(accountant.navigation.length).toBeGreaterThan(boot.navigation.length);
  });

  it("lists, opens and starts records the way the web does", async () => {
    const ctx = await makeCtx();
    await seedDemo(ctx);
    const list = await call(ctx, "appRecordList", { params: { resource: "invoices" }, query: { limit: "5" } });
    expect(list.rows.length).toBeGreaterThan(0);
    expect(list.total).toBeGreaterThanOrEqual(list.rows.length);
    expect(typeof list.totals.total).toBe("number");
    const first = list.rows[0];
    expect(list.labels.contact_id[String(first.contact_id)]).toBeTruthy();

    const view = await call(ctx, "appRecord", { params: { resource: "invoices", id: String(first.id) } });
    expect(view.record.id).toBe(first.id);
    expect(view.pdf).toBe(`/invoices/${first.id}/pdf`);
    expect(Array.isArray(view.actions)).toBe(true);
    expect(view.title).toBeTruthy();

    const fresh = await call(ctx, "appRecordNew", { params: { resource: "invoices" } });
    expect(fresh.values.currency_code).toBe("CHF");
    expect(fresh.values.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fresh.taxes.length).toBeGreaterThan(0);

    const totals = await call(ctx, "appDocumentTotals", {
      body: { vat_mode: "excl", currency_code: "CHF", positions: [{ type: "custom", quantity: 3, unit_price: 180, tax_id: fresh.taxes.find((x: { rate: number }) => x.rate === 8.1).id }] },
    });
    expect(totals.total_net).toBe(540);
    expect(totals.total_vat).toBeCloseTo(43.74, 2);
    expect(totals.total).toBe(583.75);

    const options = await call(ctx, "appOptions", { params: { resource: "contacts" }, query: { q: "" } });
    expect(options.length).toBeGreaterThan(0);
  });

  it("renders every report as tables and as a workbook", async () => {
    const ctx = await makeCtx();
    await seedDemo(ctx);
    for (const id of ["balance-sheet", "income-statement", "trial-balance", "vat", "ledger", "journal", "receivables", "payables", "liquidity", "salaries"]) {
      const view = await call(ctx, "appReport", { params: { report: id }, query: {} });
      expect(view.tables.length, id).toBeGreaterThan(0);
      for (const table of view.tables) for (const row of table.rows) expect(row.cells.length, id).toBe(table.columns.length);
    }
    const xlsx = (await call(ctx, "appReport", { params: { report: "vat" }, query: { format: "xlsx" } })) as Response;
    expect(xlsx.headers.get("content-type")).toContain("spreadsheetml");
    expect((await xlsx.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it("previews and runs quick sentences with translated text", async () => {
    const ctx = await makeCtx();
    await seedDemo(ctx);
    const plan = await call(ctx, "appQuickPlan", { body: { text: "paid 42.50 for train tickets yesterday" }, locale: "en" });
    expect(typeof plan.headline).toBe("string");
    expect(plan.actions.length).toBeGreaterThan(0);
    const outcome = await call(ctx, "appQuickRun", { body: { text: "paid 42.50 for train tickets yesterday", actionId: plan.actions[0].id }, locale: "en" });
    expect(typeof outcome.message).toBe("string");
  });

  it("serves the Today screen", async () => {
    const ctx = await makeCtx();
    await seedDemo(ctx);
    const today = await call(ctx, "appToday");
    expect(today.greeting).toBeTruthy();
    expect(Array.isArray(today.nudges)).toBe(true);
    for (const n of today.nudges) {
      expect(typeof n.title).toBe("string");
      for (const a of n.actions) expect(typeof a.label).toBe("string");
    }
  });

  it("shares settings forms and number formats", async () => {
    const ctx = await makeCtx();
    const settings = await call(ctx, "appSettings", { locale: "it" });
    expect(settings.forms.company.fields.find((f: { name: string }) => f.name === "name").label).not.toBe("Company name");
    expect(settings.numbering.find((n: { key: string }) => n.key === "invoice").preview).toMatch(/^INV-/);
    await call(ctx, "appSaveSettings", { params: { group: "accounting" }, body: { default_payment_days: "20" } });
    const again = await call(ctx, "appSettings");
    expect(again.forms.accounting.values.default_payment_days).toBe(20);
    const saved = await call(ctx, "appSaveNumbering", { params: { key: "invoice" }, body: { format: "RE-{YYYY}-{###}", next_value: 7 } });
    expect(saved.preview).toMatch(/^RE-\d{4}-007$/);
  });
});
