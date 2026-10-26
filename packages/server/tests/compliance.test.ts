import { describe, expect, it } from "vitest";
import { calculateDocument, splitAmount } from "@batzio/core/calc/documents";
import { BVG_LIMITS, calculatePayslip, coordinatedSalary } from "@batzio/core/calc/payroll";
import { vatFromGross, vatFromNet } from "@batzio/core/money";
import { accountIdByNumber, closeBusinessYear, postEntry, reverseEntry, trialBalance, vatReport } from "../src/accounting";
import { verifyAuditLog } from "../src/audit";
import { createRecord, deleteRecord, getRecord, runAction, updateRecord } from "../src/crud";
import { storeFile } from "../src/files";
import { getResource } from "../src/resources/registry";
import { seedDemo } from "../src/seed";
import { makeCtx } from "./helpers/tenant";

/**
 * Swiss bookkeeping and VAT rules the engine must keep (OR 957 ff., GeBüV,
 * MWSTG/MWSTV, BVG/AHVG), checked against worked examples.
 */

describe("VAT amounts", () => {
  it("matches the ESTV examples for net and gross prices at every 2024+ rate", () => {
    expect(vatFromNet(10_000, 8.1)).toBe(810);
    expect(vatFromGross(10_810, 8.1)).toBe(810);
    expect(vatFromNet(10_000, 2.6)).toBe(260);
    expect(vatFromGross(10_380, 3.8)).toBe(380);
  });

  it("gives a credit note exactly the opposite VAT of its invoice", () => {
    for (const cents of [1, 5, 15, 123, 999, 12_345, 1_850, 6_185]) {
      for (const rate of [8.1, 2.6, 3.8]) {
        expect(vatFromNet(-cents, rate) + vatFromNet(cents, rate)).toBe(0);
        expect(vatFromGross(-cents, rate) + vatFromGross(cents, rate)).toBe(0);
      }
    }
    const invoice = calculateDocument([{ type: "custom", quantity: 3, unit_price: 61.85, tax_rate: 8.1 }], "excl", 0.05);
    const credit = calculateDocument([{ type: "custom", quantity: -3, unit_price: 61.85, tax_rate: 8.1 }], "excl", 0.05);
    expect(credit.totalVat).toBe(-invoice.totalVat);
    expect(credit.total).toBe(-invoice.total);
  });

  it("rounds only the total to 5 Rappen, never the VAT", () => {
    const r = calculateDocument([{ type: "custom", quantity: 1, unit_price: 99.99, tax_rate: 8.1 }], "excl", 0.05);
    expect(r.totalVat).toBe(810); // 8.0992 → 8.10
    expect(r.totalGross).toBe(10_809);
    expect(r.total).toBe(10_810);
    expect(r.rounding).toBe(1);
    const eur = calculateDocument([{ type: "custom", quantity: 1, unit_price: 99.99, tax_rate: 8.1 }], "excl", 0.01);
    expect(eur.total).toBe(10_809);
  });

  it("keeps net + VAT = gross for receipts entered with VAT included", () => {
    for (const cents of [100, 4_250, 8_760, 123_456]) {
      const s = splitAmount(cents, 8.1, "incl");
      expect(s.net + s.vat).toBe(cents);
    }
  });
});

describe("payroll (2026)", () => {
  it("bases BVG on the coordinated salary of the mandatory scheme", () => {
    expect(BVG_LIMITS).toMatchObject({ entryThreshold: 2_268_000, coordinationDeduction: 2_646_000, maxCoordinated: 6_426_000, minCoordinated: 378_000 });
    expect(coordinatedSalary(8_000_000)).toBe(5_354_000); // 80'000 − 26'460
    expect(coordinatedSalary(2_000_000)).toBe(0); // below the entry threshold
    expect(coordinatedSalary(2_800_000)).toBe(378_000); // at least the minimum
    expect(coordinatedSalary(15_000_000)).toBe(6_426_000); // capped
    const slip = calculatePayslip({ gross: 650_000, bvgRate: 5, nbuRate: 0, ktgRate: 0, withholdingTaxRate: 0, childAllowance: 0, bvgAnnualSalary: 650_000 * 13 });
    // (84'500 − 26'460) / 12 × 5 % = 241.83 → 241.85
    expect(slip.bvg).toBe(24_185);
  });

  it("deducts AHV/IV/EO and ALV at the 2026 rates, ALV up to the ceiling", () => {
    const slip = calculatePayslip({ gross: 1_500_000, bvgRate: 0, nbuRate: 0, ktgRate: 0, withholdingTaxRate: 0, childAllowance: 0 });
    expect(slip.ahv).toBe(79_500); // 5.3 %
    expect(slip.alv).toBe(13_585); // 1.1 % of 12'350
  });

  it("charges withholding tax on family allowances too, social contributions not", () => {
    const slip = calculatePayslip({ gross: 500_000, bvgRate: 0, nbuRate: 0, ktgRate: 0, withholdingTaxRate: 10, childAllowance: 21_500 });
    expect(slip.ahv).toBe(26_500);
    expect(slip.withholding_tax).toBe(52_150);
    expect(slip.net).toBe(500_000 - slip.totalDeductions + 21_500);
  });
});

describe("books", () => {
  it("stay balanced and every VAT return adds up", async () => {
    const ctx = await makeCtx();
    await seedDemo(ctx);
    const year = new Date().getFullYear();
    const tb = await trialBalance(ctx, `${year}-01-01`, `${year}-12-31`);
    const debit = tb.rows.reduce((s: number, r: { debit: number }) => s + r.debit, 0);
    const credit = tb.rows.reduce((s: number, r: { credit: number }) => s + r.credit, 0);
    expect(debit).toBe(credit);
    const vat = await vatReport(ctx, `${year}-01-01`, `${year}-12-31`);
    expect(vat.digits["299"]).toBe(vat.digits["200"] - vat.digits["289"]);
    expect(vat.digits["399"]).toBe(vat.digits["303_tax"] + vat.digits["313_tax"] + vat.digits["343_tax"]);
    expect(vat.digits["500"] - vat.digits["510"]).toBe(vat.digits["399"] - vat.digits["479"]);
  });

  it("never change once booked: corrections are reversals", async () => {
    const ctx = await makeCtx();
    const date = `${new Date().getFullYear()}-03-31`;
    const cash = await accountIdByNumber(ctx, "1000");
    const office = await accountIdByNumber(ctx, "6500");
    const id = await postEntry(ctx, { date, description: "Office supplies", type: "manual", locked: true, lines: [{ debit_account_id: office, credit_account_id: cash, amount: 4_250 }] });
    const entries = getResource("journal_entries")!;
    await expect(updateRecord(ctx, entries, id, { description: "Changed" })).rejects.toThrow(/locked/i);
    await expect(deleteRecord(ctx, entries, id)).rejects.toThrow(/reversal/i);
    const reversal = await reverseEntry(ctx, id, date);
    const lines = (await getRecord(ctx, entries, reversal)).lines as { debit_account_id: number; credit_account_id: number; amount: number }[];
    expect(lines[0]).toMatchObject({ debit_account_id: cash, credit_account_id: office, amount: 4_250 });
  });

  it("refuse anything dated in a closed business year", async () => {
    const ctx = await makeCtx();
    const year = await ctx.db.first<{ id: number; start_date: string }>("SELECT id, start_date FROM business_years ORDER BY start_date LIMIT 1");
    await closeBusinessYear(ctx, year!.id);
    const cash = await accountIdByNumber(ctx, "1000");
    const office = await accountIdByNumber(ctx, "6500");
    await expect(postEntry(ctx, { date: year!.start_date, description: "Late", type: "manual", lines: [{ debit_account_id: office, credit_account_id: cash, amount: 100 }] })).rejects.toThrow(/closed/);
  });

  it("keep receipts of booked records (ten years, Art. 958f CO)", async () => {
    const ctx = await makeCtx();
    const supplier = await createRecord(ctx, getResource("contacts")!, { type: "company", name_1: "Papeterie AG", is_supplier: true });
    const receipt = await storeFile(ctx, { name: "receipt.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF receipt").buffer as ArrayBuffer });
    const bill = await createRecord(ctx, getResource("bills")!, { contact_id: supplier.id, file_id: receipt.id, lines: [{ text: "Paper", amount: 42.5 }] });
    await runAction(ctx, getResource("bills")!, Number(bill.id), "book");
    await expect(deleteRecord(ctx, getResource("files")!, receipt.id)).rejects.toThrow(/958f/);
    const draft = await storeFile(ctx, { name: "draft.pdf", type: "application/pdf", bytes: new TextEncoder().encode("%PDF draft").buffer as ArrayBuffer });
    await deleteRecord(ctx, getResource("files")!, draft.id);
  });

  it("keep an unbroken, tamper-evident trail of every change (GeBüV)", async () => {
    const ctx = await makeCtx();
    await seedDemo(ctx);
    const v = await verifyAuditLog(ctx);
    expect(v.ok).toBe(true);
    expect(v.checked).toBeGreaterThan(50);
  });
});
