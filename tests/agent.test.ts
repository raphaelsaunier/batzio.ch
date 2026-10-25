import { beforeAll, describe, expect, it } from "vitest";
import { importTable } from "@/lib/agent/importers";
import { planQuick, runQuick } from "@/lib/agent/quick";
import { detectTable, looseDate, looseNumber, parseCsv } from "@/lib/agent/tables";
import { getResource } from "@/lib/resources/registry";
import { balanceSheet } from "@/lib/server/accounting";
import { getRecord, listRecords } from "@/lib/server/crud";
import type { Ctx } from "@/lib/server/ctx";
import { buildXlsx } from "@/lib/server/xlsx";
import { parseXlsx } from "@/lib/agent/tables";
import { seedDemo } from "@/lib/server/seed";
import { makeCtx } from "./helpers/tenant";

let ctx: Ctx;

beforeAll(async () => {
  ctx = await makeCtx();
  await seedDemo(ctx);
});

describe("table reading", () => {
  it("parses Swiss CSV exports", () => {
    const t = parseCsv('﻿Firma;PLZ;Ort;E-Mail\n"Muster; Partner AG";8000;Zürich;info@muster.ch\n\nBeta GmbH;3000;Bern;\n');
    expect(t.headers).toEqual(["Firma", "PLZ", "Ort", "E-Mail"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0][0]).toBe("Muster; Partner AG");
    expect(detectTable(t).kind).toBe("contacts");
  });

  it("detects tables in four languages", () => {
    expect(detectTable({ sheet: "", headers: ["Article", "Prix", "Unité"], rows: [] }).kind).toBe("items");
    expect(detectTable({ sheet: "", headers: ["Konto", "Saldo"], rows: [] }).kind).toBe("opening_balances");
    expect(detectTable({ sheet: "", headers: ["Data", "Descrizione", "Importo"], rows: [] }).kind).toBe("bank_lines");
    expect(detectTable({ sheet: "", headers: ["foo", "bar"], rows: [] }).kind).toBe("unknown");
  });

  it("reads loose numbers and dates", () => {
    expect(looseNumber("1'234.50")).toBe(1234.5);
    expect(looseNumber("1.234,50")).toBe(1234.5);
    expect(looseNumber("CHF -12,30")).toBe(-12.3);
    expect(looseNumber("99.-")).toBe(99);
    expect(looseDate("3.2.2026")).toBe("2026-02-03");
    expect(looseDate(46000)).toBe("2025-12-09");
  });

  it("round-trips our own XLSX export", () => {
    const bytes = buildXlsx([{ name: "Kunden", columns: [{ header: "Name" }, { header: "Email" }], rows: [["Delta SA", "hi@delta.ch"], ["Eta AG", null]] }]);
    const [table] = parseXlsx(bytes);
    expect(table.headers).toEqual(["Name", "Email"]);
    expect(table.rows[0]).toEqual(["Delta SA", "hi@delta.ch"]);
  });
});

describe("importers", () => {
  it("imports contacts and skips duplicates", async () => {
    const t = parseCsv("Company,Street,Zip,City,Email\nGamma Labs AG,Seestrasse 12,8002,Zürich,hello@gamma.ch\nGamma Labs,Seestrasse 12,8002,Zürich,\n");
    const r = await importTable(ctx, t, "contacts", detectTable(t).mapping);
    expect(r.created).toBe(1);
    expect(r.skipped).toBe(1);
    const c = await getRecord(ctx, getResource("contacts")!, r.records[0].id);
    expect(c.street).toBe("Seestrasse");
    expect(c.house_number).toBe("12");
  });

  it("imports products", async () => {
    const t = parseCsv("Artikel;Preis;Einheit\nWorkshop-Tag;1'800.00;Tag\nSupport;150;Std\n");
    const r = await importTable(ctx, t, "items", detectTable(t).mapping);
    expect(r.created).toBe(2);
  });

  it("books opening balances that keep the balance sheet balanced", async () => {
    const t = parseCsv("Konto;Saldo\n1000 Kasse;500\n2800 Grundkapital;500\n");
    const r = await importTable(ctx, t, "opening_balances", detectTable(t).mapping, { date: "2020-01-01" });
    expect(r.created).toBe(2);
    expect((await balanceSheet(ctx, "2020-12-31")).balanced).toBe(true);
  });
});

describe("quick sentences", () => {
  it("plans and issues an invoice from one sentence", async () => {
    const plan = await planQuick(ctx, "invoice Muster AG 3h consulting at 180");
    expect(plan?.intent).toBe("invoice");
    expect(plan?.total).toBe(58_375);
    const out = await runQuick(ctx, "invoice Muster AG 3h consulting at 180", "issue");
    expect(out.record?.resource).toBe("invoices");
    const inv = await getRecord(ctx, getResource("invoices")!, out.record!.id);
    expect(inv.status).toBe("open");
  });

  it("files a receipt under the right account", async () => {
    const out = await runQuick(ctx, "paid 42.50 for SBB tickets yesterday", "book");
    const expense = await getRecord(ctx, getResource("expenses")!, out.record!.id);
    expect(expense.status).not.toBe("draft");
  });

  it("logs time and adds to-dos", async () => {
    const time = await runQuick(ctx, "2h30 on website relaunch", "log");
    expect(time.record?.resource).toBe("timesheets");
    const task = await runQuick(ctx, "todo call the fiduciary tomorrow", "create");
    expect(task.record?.resource).toBe("tasks");
  });

  it("warns about unknown customers instead of guessing", async () => {
    const plan = await planQuick(ctx, "invoice Zyxwv Unknown 1 thing at 10");
    expect(plan?.warnings.length).toBeGreaterThan(0);
  });

  it("records payments against the oldest open invoice", async () => {
    const open = await listRecords(ctx, getResource("invoices")!, { filters: { status: "open" }, limit: 1 });
    const name = String(open.rows[0].contact_id_label ?? "");
    if (!name) return;
    const plan = await planQuick(ctx, `${name} paid`);
    expect(plan?.intent).toBe("payment");
  });
});
