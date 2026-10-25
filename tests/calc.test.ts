import { describe, expect, it } from "vitest";
import { calculateDocument } from "@/lib/calc/documents";
import { calculatePayslip } from "@/lib/calc/payroll";
import { toCents } from "@/lib/money";

describe("money", () => {
  it("rounds half away from zero", () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents("1’234.50")).toBe(123450);
    expect(toCents(-2.675)).toBe(-268);
  });
});

describe("document calculation", () => {
  it("computes VAT on net prices per rate", () => {
    const r = calculateDocument(
      [
        { type: "custom", quantity: 2, unit_price: 100, tax_id: 1, tax_rate: 8.1 },
        { type: "custom", quantity: 1, unit_price: 50, tax_id: 2, tax_rate: 2.6 },
        { type: "text" },
      ],
      "excl",
      0.05,
    );
    expect(r.totalNet).toBe(25000);
    expect(r.totalVat).toBe(1620 + 130);
    expect(r.totalGross).toBe(26750);
    expect(r.total).toBe(26750);
  });

  it("extracts VAT from gross prices and applies cash rounding", () => {
    const r = calculateDocument([{ type: "custom", quantity: 1, unit_price: 99.99, tax_id: 1, tax_rate: 8.1 }], "incl", 0.05);
    expect(r.totalGross).toBe(9999);
    expect(r.totalVat).toBe(749);
    expect(r.total).toBe(10000);
    expect(r.rounding).toBe(1);
  });

  it("spreads percentage discounts over VAT buckets and ignores optional positions", () => {
    const r = calculateDocument(
      [
        { type: "custom", quantity: 1, unit_price: 1000, tax_id: 1, tax_rate: 8.1 },
        { type: "custom", quantity: 1, unit_price: 500, tax_id: 1, tax_rate: 8.1, is_optional: true },
        { type: "subtotal" },
        { type: "discount", discount_percent: 10 },
      ],
      "excl",
    );
    expect(r.lines[2].subtotal).toBe(100000);
    expect(r.lines[3].total).toBe(-10000);
    expect(r.totalNet).toBe(90000);
    expect(r.totalVat).toBe(7290);
  });
});

describe("payroll", () => {
  it("applies Swiss social security deductions", () => {
    const p = calculatePayslip({ gross: 800000, bvgRate: 6, nbuRate: 1.2, ktgRate: 0.5, withholdingTaxRate: 0, childAllowance: 21500 });
    expect(p.ahv).toBe(42400);
    expect(p.alv).toBe(8800);
    expect(p.bvg).toBe(48000);
    expect(p.net).toBe(800000 - (42400 + 8800 + 48000 + 9600 + 4000) + 21500);
    expect(p.employer_cost).toBeGreaterThan(800000);
  });
  it("caps ALV at the insured salary ceiling", () => {
    const p = calculatePayslip({ gross: 2000000, bvgRate: 0, nbuRate: 0, ktgRate: 0, withholdingTaxRate: 0, childAllowance: 0 });
    expect(p.alv).toBe(Math.round((1235000 * 1.1) / 100 / 5) * 5);
  });
});
