import { roundCents } from "@/lib/money";

/** Swiss social security rates (employee share unless noted), 2026. */
export interface PayrollRates {
  /** AHV/IV/EO employee share in %. */
  ahv: number;
  /** ALV (unemployment insurance) employee share in %. */
  alv: number;
  /** Monthly ALV insured salary ceiling in cents (CHF 148'200 / 12). */
  alvCeilingMonthly: number;
  /** Family compensation fund, employer only, in %. */
  fak: number;
  /** Occupational accident insurance (BU), employer only, in %. */
  uvgBu: number;
  /** AHV administrative cost surcharge, employer, % of AHV contributions. */
  adminCost: number;
}

export const DEFAULT_PAYROLL_RATES: PayrollRates = {
  ahv: 5.3,
  alv: 1.1,
  alvCeilingMonthly: 1_235_000,
  fak: 1.2,
  uvgBu: 0.5,
  adminCost: 3,
};

export interface PayslipInput {
  /** Gross salary in cents (incl. 13th salary share if paid this month). */
  gross: number;
  bvgRate: number;
  nbuRate: number;
  ktgRate: number;
  withholdingTaxRate: number;
  /** Child/education allowances in cents (not subject to contributions). */
  childAllowance: number;
}

export interface PayslipResult {
  gross: number;
  ahv: number;
  alv: number;
  bvg: number;
  nbu: number;
  ktg: number;
  withholding_tax: number;
  allowances: number;
  totalDeductions: number;
  net: number;
  employer: { ahv: number; alv: number; fak: number; bvg: number; uvg: number; admin: number; total: number };
  employer_cost: number;
}

const pct = (base: number, rate: number) => roundCents(Math.round((base * rate) / 100), 0.05);

export function calculatePayslip(input: PayslipInput, rates: PayrollRates = DEFAULT_PAYROLL_RATES): PayslipResult {
  const gross = Math.max(0, Math.round(input.gross));
  const alvBase = Math.min(gross, rates.alvCeilingMonthly);
  const ahv = pct(gross, rates.ahv);
  const alv = pct(alvBase, rates.alv);
  const bvg = pct(gross, input.bvgRate);
  const nbu = pct(Math.min(gross, rates.alvCeilingMonthly), input.nbuRate);
  const ktg = pct(gross, input.ktgRate);
  const withholding_tax = pct(gross, input.withholdingTaxRate);
  const allowances = Math.max(0, Math.round(input.childAllowance));
  const totalDeductions = ahv + alv + bvg + nbu + ktg + withholding_tax;
  const net = gross - totalDeductions + allowances;

  const employer = {
    ahv: pct(gross, rates.ahv),
    alv: pct(alvBase, rates.alv),
    fak: pct(gross, rates.fak),
    bvg,
    uvg: pct(Math.min(gross, rates.alvCeilingMonthly), rates.uvgBu),
    admin: roundCents(Math.round((pct(gross, rates.ahv) * 2 * rates.adminCost) / 100), 0.05),
    total: 0,
  };
  employer.total = employer.ahv + employer.alv + employer.fak + employer.bvg + employer.uvg + employer.admin;
  return {
    gross,
    ahv,
    alv,
    bvg,
    nbu,
    ktg,
    withholding_tax,
    allowances,
    totalDeductions,
    net,
    employer,
    employer_cost: gross + employer.total,
  };
}
