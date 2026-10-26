import { roundCents } from "../money";

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

/** BVG thresholds for the mandatory occupational pension (yearly amounts in cents), 2025 and 2026. */
export const BVG_LIMITS = {
  /** Below this yearly salary there is no mandatory pension insurance. */
  entryThreshold: 2_268_000,
  coordinationDeduction: 2_646_000,
  /** Highest salary insured in the mandatory part. */
  upperLimit: 9_072_000,
  minCoordinated: 378_000,
  maxCoordinated: 6_426_000,
};

/**
 * The coordinated salary (koordinierter Lohn) a BVG contribution is based on: the
 * yearly salary minus the coordination deduction, kept between the minimum and
 * maximum; nothing below the entry threshold. Returned as a yearly amount in cents.
 */
export function coordinatedSalary(annualCents: number): number {
  if (annualCents < BVG_LIMITS.entryThreshold) return 0;
  const coordinated = Math.min(annualCents, BVG_LIMITS.upperLimit) - BVG_LIMITS.coordinationDeduction;
  return Math.min(BVG_LIMITS.maxCoordinated, Math.max(BVG_LIMITS.minCoordinated, coordinated));
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
  /** Child/education allowances in cents (not subject to social contributions, but to withholding tax). */
  childAllowance: number;
  /**
   * The insured yearly salary in cents. When given, BVG is charged on the
   * coordinated salary (as the BVG defines it), a twelfth each month; otherwise
   * on this month's gross (pension funds that insure the full salary).
   */
  bvgAnnualSalary?: number | null;
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
  const bvgBase = input.bvgAnnualSalary ? Math.round(coordinatedSalary(input.bvgAnnualSalary) / 12) : gross;
  const bvg = pct(bvgBase, input.bvgRate);
  const nbu = pct(Math.min(gross, rates.alvCeilingMonthly), input.nbuRate);
  const ktg = pct(gross, input.ktgRate);
  const allowances = Math.max(0, Math.round(input.childAllowance));
  // Family allowances are free of AHV/ALV but count for withholding tax.
  const withholding_tax = pct(gross + allowances, input.withholdingTaxRate);
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
