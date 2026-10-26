import { beforeAll, describe, expect, it } from "vitest";
import { findTool, inputJsonSchema, needsConfirmation, runTool, toolkit } from "../src/agent/toolkit";
import type { Ctx } from "../src/ctx";
import { seedDemo } from "../src/seed";
import { makeCtx } from "./helpers/tenant";

let ctx: Ctx;
const run = (name: string, input: unknown) => runTool(ctx, findTool(name)!, input) as Promise<Record<string, unknown>>;

beforeAll(async () => {
  ctx = await makeCtx();
  await seedDemo(ctx);
});

describe("toolkit", () => {
  it("has unique names and valid JSON schemas", () => {
    const names = toolkit().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of toolkit()) {
      const schema = inputJsonSchema(tool);
      expect(schema.type, tool.name).toBe("object");
      expect(JSON.stringify(schema)).not.toContain("$schema");
    }
  });

  it("flags destructive tools for confirmation", () => {
    expect(needsConfirmation(findTool("delete_record")!, {})).toBe(true);
    expect(needsConfirmation(findTool("run_record_action")!, { resource: "invoices", action: "cancel" })).toBe(true);
    expect(needsConfirmation(findTool("run_record_action")!, { resource: "invoices", action: "issue" })).toBe(false);
    expect(needsConfirmation(findTool("update_accounting_settings")!, { values: { vat_method: "net_tax_rate" } })).toBe(true);
    expect(needsConfirmation(findTool("update_accounting_settings")!, { values: { reminder_days: 14 } })).toBe(false);
  });

  it("records a scanned bill with a new supplier", async () => {
    const out = await run("create_bill", {
      supplier: { name: "Bergbahnen Test AG", iban: "CH93 0076 2011 6238 5295 7", city: "Davos" },
      date: "2026-03-02",
      lines: [{ text: "Swisscom mobile subscription March", amount: 64.9 }],
      book: true,
    });
    expect(out.supplier_created).toBe(true);
    const bill = out.bill as Record<string, unknown>;
    expect(bill.status).toBe("booked");
    expect(bill.total).toBe(64.9);
  });

  it("records a receipt and guesses the account", async () => {
    const out = await run("create_expense", { title: "SBB ticket Zürich–Bern", amount: 51, date: "2026-03-03" });
    expect(out.status).toBe("booked");
  });

  it("imports extracted rows", async () => {
    const out = await run("import_rows", { kind: "contacts", rows: [{ name: "Screenshot GmbH", city: "Basel", email: "hi@screenshot.example" }] });
    expect(out.created).toBe(1);
  });

  it("changes number formats and settings", async () => {
    const out = await run("set_number_format", { sequence: "invoice", format: "RE-{YY}-{#####}", next_value: 501 });
    expect(String(out.next)).toMatch(/^RE-\d{2}-00501$/);
    await expect(run("set_number_format", { sequence: "invoice", format: "RE-{YY}" })).rejects.toThrow(/counter/);
    const company = await run("update_company_settings", { values: { website: "https://example.ch" } });
    expect(company.website).toBe("https://example.ch");
  });

  it("validates input", async () => {
    await expect(run("create_expense", { title: "x" })).rejects.toThrow(/amount/);
  });
});

describe("letterhead", () => {
  it("prints the logo set through the toolkit on invoices", async () => {
    const { readFileSync } = await import("node:fs");
    const { storeFile } = await import("../src/files");
    const { renderDocumentPdf } = await import("../src/pdf/document");
    const { getRecord: get } = await import("../src/crud");
    const { getResource } = await import("../src/resources/registry");
    const png = readFileSync(new URL("../../../apps/web/public/brand/coin-front-160.png", import.meta.url));
    const file = await storeFile(ctx, { name: "logo.png", type: "image/png", bytes: png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer });
    await run("set_company_logo", { file_id: file.id });
    await run("update_company_settings", { values: { accent_color: "#7a2f8f" } });
    const invoice = await run("create_invoice", { customer: "Bergsicht", positions: [{ text: "Logo test", quantity: 1, unit_price: 10 }] });
    const doc = await get(ctx, getResource("invoices")!, Number(invoice.id));
    const pdf = new TextDecoder("latin1").decode(await renderDocumentPdf(ctx, doc as never));
    expect(pdf).toContain("/Subtype /Image");
  });
});
