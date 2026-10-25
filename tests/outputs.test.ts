import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { buildOpenApi } from "@/lib/api/openapi";
import { getResource } from "@/lib/resources/registry";
import { balanceSheet, vatReport } from "@/lib/server/accounting";
import { getRecord, listAll, runAction } from "@/lib/server/crud";
import type { Ctx } from "@/lib/server/ctx";
import { resourceSheet, vatSheets } from "@/lib/server/exports";
import { renderDocumentPdf, renderReminderPdf, type ReminderRow } from "@/lib/server/pdf/document";
import { renderPayslipPdf, renderReportPdf, renderVatPdf } from "@/lib/server/pdf/reports";
import type { DocumentRow } from "@/lib/server/sales";
import { seedDemo } from "@/lib/server/seed";
import { buildXlsx } from "@/lib/server/xlsx";
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
