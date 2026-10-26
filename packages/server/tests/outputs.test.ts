import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, unzipSync, unzlibSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOpenApi } from "../src/api/openapi";
import { getResource } from "../src/resources/registry";
import { balanceSheet, vatReport } from "../src/accounting";
import { getRecord, listAll, runAction } from "../src/crud";
import type { Ctx } from "../src/ctx";
import { resourceSheet, vatSheets } from "../src/exports";
import { renderDocumentPdf, renderReminderPdf, type ReminderRow } from "../src/pdf/document";
import { renderPayslipPdf, renderReportPdf, renderVatPdf } from "../src/pdf/reports";
import type { DocumentRow } from "../src/sales";
import { seedDemo } from "../src/seed";
import { saveSettings } from "../src/settings";
import { buildXlsx } from "../src/xlsx";
import { makeCtx } from "./helpers/tenant";

/** Set SAMPLES_DIR to write the generated files for manual inspection. */
const out = process.env.SAMPLES_DIR;
const save = (name: string, bytes: Uint8Array) => {
  if (!out) return;
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, name), bytes);
};

let ctx: Ctx;
const year = new Date().getUTCFullYear();

beforeAll(async () => {
  ctx = await makeCtx();
  await seedDemo(ctx);
});

async function pageCount(bytes: Uint8Array) {
  return (await PDFDocument.load(bytes)).getPageCount();
}

/** The text a PDF draws, line by line (standard fonts write it as WinAnsi hex strings). */
function pdfText(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes).toString("latin1");
  const lines: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = m.index! + m[0].length;
    const end = raw.indexOf("endstream", start);
    let content: string;
    try {
      content = strFromU8(unzlibSync(bytes.subarray(start, end)), true);
    } catch {
      continue;
    }
    for (const t of content.matchAll(/<([0-9A-Fa-f]*)> Tj/g)) lines.push(Buffer.from(t[1], "hex").toString("latin1"));
  }
  return lines;
}

describe("PDF output", () => {
  it("renders an open invoice with a QR-bill", async () => {
    const res = getResource("invoices")!;
    const open = (await listAll(ctx, res, { filters: { status: "open" } }))[0];
    const doc = (await getRecord(ctx, res, Number(open.id))) as unknown as DocumentRow;
    const bytes = await renderDocumentPdf(ctx, doc);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(await pageCount(bytes)).toBeGreaterThanOrEqual(1);
    save("invoice.pdf", bytes);
  });

  it("prints the company's own page footer (two lines, cut to fit) or company, UID and the document's IBAN", async () => {
    const quote = (await getRecord(ctx, getResource("quotes")!, 1)) as unknown as DocumentRow;
    await saveSettings(ctx, "company", { document_footer: `Muster AG · Handelsregister Bern\nBank ${"x".repeat(300)}\nThird line` });
    const own = pdfText(await renderDocumentPdf(ctx, quote));
    expect(own).toContain("Muster AG \xb7 Handelsregister Bern");
    const cut = own.find((l) => l.startsWith("Bank x"))!;
    expect(cut.endsWith("\x85")).toBe(true); // “…” in WinAnsi
    expect(cut.length).toBeLessThan(250);
    expect(own.some((l) => l.includes("Third line"))).toBe(false);

    await saveSettings(ctx, "company", { document_footer: "" });
    const second = await ctx.db.value<number>("INSERT INTO bank_accounts (name, iban, currency_code) VALUES ('Second', 'CH5604835012345678009', 'CHF') RETURNING id");
    const auto = pdfText(await renderDocumentPdf(ctx, { ...quote, bank_account_id: second }));
    expect(auto.find((l) => l.includes("UID"))).toMatch(/\|   IBAN CH56 0483 5012 3456 7800 9$/);
  });

  it("renders a multi-section quote, a reminder and a payslip", async () => {
    const quote = (await getRecord(ctx, getResource("quotes")!, 1)) as unknown as DocumentRow;
    save("quote.pdf", await renderDocumentPdf(ctx, quote));

    const invoices = getResource("invoices")!;
    const open = (await listAll(ctx, invoices, { filters: { status: "open" } }))[0];
    const result = await runAction(ctx, invoices, Number(open.id), "create_reminder");
    const reminder = (await getRecord(ctx, getResource("reminders")!, result.redirect!.id)) as unknown as ReminderRow;
    const doc = (await getRecord(ctx, invoices, reminder.document_id)) as unknown as DocumentRow;
    save("reminder.pdf", await renderReminderPdf(ctx, reminder, doc));

    const slip = await getRecord(ctx, getResource("payslips")!, 1);
    const employee = await getRecord(ctx, getResource("employees")!, Number(slip.employee_id));
    const pdf = await renderPayslipPdf(ctx, { employee, slip });
    expect(await pageCount(pdf)).toBe(1);
    save("payslip.pdf", pdf);
  });

  it("renders financial reports", async () => {
    save("balance-sheet.pdf", await renderReportPdf(ctx, await balanceSheet(ctx, `${year}-12-31`)));
    save("vat.pdf", await renderVatPdf(ctx, await vatReport(ctx, `${year}-01-01`, `${year}-12-31`)));
  });
});

describe("XLSX output", () => {
  it("builds a valid workbook", async () => {
    const res = getResource("invoices")!;
    const sheets = [await resourceSheet(ctx, res, await listAll(ctx, res)), ...vatSheets(await vatReport(ctx, `${year}-01-01`, `${year}-12-31`), "Test AG")];
    const bytes = buildXlsx(sheets);
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toContain("xl/worksheets/sheet3.xml");
    expect(strFromU8(files["xl/workbook.xml"])).toContain('name="Invoices"');
    expect(strFromU8(files["xl/worksheets/sheet1.xml"])).toContain("INV-");
    save("export.xlsx", bytes);
  });
});

describe("OpenAPI", () => {
  it("documents every resource and operation", () => {
    const spec = buildOpenApi("https://batzio.example") as { paths: Record<string, Record<string, { operationId: string }>> };
    expect(spec.paths["/invoices/{id}/record_payment"].post.operationId).toBe("recordPaymentInvoice");
    expect(spec.paths["/reports/vat"].get.operationId).toBe("getVatReport");
    const ids = Object.values(spec.paths).flatMap((p) => Object.values(p).map((o) => o.operationId));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
