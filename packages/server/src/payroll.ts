import { calculatePayslip, DEFAULT_PAYROLL_RATES } from "@batzio/core/calc/payroll";
import type { Row } from "./resources/types";
import { SYSTEM_ACCOUNTS } from "@batzio/core/swiss/chart-of-accounts";
import { accountIdByNumber, postEntry, reverseEntry, type EntryLineInput } from "./accounting";
import { audit } from "./audit";
import { patchColumns } from "./crud";
import type { Ctx } from "./ctx";
import { AppError } from "./errors";

export interface EmployeeRow {
  id: number;
  nr: string | null;
  firstname: string;
  lastname: string;
  entry_date: string | null;
  exit_date: string | null;
  salary_type: "monthly" | "hourly";
  monthly_salary: number;
  thirteenth_salary: number;
  bvg_rate: number;
  nbu_rate: number;
  ktg_rate: number;
  withholding_tax_rate: number;
  child_allowance: number;
  is_active: number;
}

export interface PayslipRow {
  id: number;
  employee_id: number;
  year: number;
  month: number;
  gross: number;
  net: number;
  status: string;
  journal_entry_id: number | null;
  details: string | null;
}

const monthEnd = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
const monthStart = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-01`;

export function payslipValues(employee: EmployeeRow, gross: number) {
  const result = calculatePayslip(
    {
      gross,
      bvgRate: employee.bvg_rate,
      nbuRate: employee.nbu_rate,
      ktgRate: employee.ktg_rate,
      withholdingTaxRate: employee.withholding_tax_rate,
      childAllowance: employee.child_allowance,
      // The salary the pension fund insures: twelve (or thirteen) monthly salaries; hourly wages extrapolated.
      bvgAnnualSalary: employee.salary_type === "hourly" ? gross * 12 : employee.monthly_salary * (employee.thirteenth_salary ? 13 : 12),
    },
    DEFAULT_PAYROLL_RATES,
  );
  return {
    gross: result.gross,
    ahv: result.ahv,
    alv: result.alv,
    bvg: result.bvg,
    nbu: result.nbu,
    ktg: result.ktg,
    withholding_tax: result.withholding_tax,
    allowances: result.allowances,
    net: result.net,
    employer_cost: result.employer_cost,
    details: JSON.stringify({ employer: result.employer, rates: DEFAULT_PAYROLL_RATES }),
  };
}

/** Creates draft payslips for every employee active in the given month. */
export async function runPayroll(ctx: Ctx, year: number, month: number): Promise<{ created: number; skipped: number }> {
  if (month < 1 || month > 12) throw new AppError("validation", "Month must be between 1 and 12.");
  const start = monthStart(year, month);
  const end = monthEnd(year, month);
  const employees = await ctx.db.all<EmployeeRow>(
    `SELECT * FROM employees WHERE is_active = 1 AND (entry_date IS NULL OR entry_date <= ?) AND (exit_date IS NULL OR exit_date >= ?)`,
    end,
    start,
  );
  let created = 0;
  let skipped = 0;
  for (const e of employees) {
    const exists = await ctx.db.value<number>("SELECT id FROM payslips WHERE employee_id = ? AND year = ? AND month = ?", e.id, year, month);
    if (exists) {
      skipped++;
      continue;
    }
    let gross = e.salary_type === "monthly" ? e.monthly_salary : 0;
    if (e.thirteenth_salary && month === 12 && e.salary_type === "monthly") gross += e.monthly_salary;
    const v = payslipValues(e, gross);
    await ctx.db.run(
      `INSERT INTO payslips (employee_id, year, month, gross, ahv, alv, bvg, nbu, ktg, withholding_tax, allowances, net, employer_cost, details, status, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      e.id, year, month, v.gross, v.ahv, v.alv, v.bvg, v.nbu, v.ktg, v.withholding_tax, v.allowances, v.net, v.employer_cost, v.details,
      ctx.actor.name, ctx.actor.name,
    );
    created++;
  }
  await audit(ctx, { action: "payroll_run", resource: "payslips", summary: `Payroll ${month}/${year}: ${created} payslips created` });
  return { created, skipped };
}

/** `prepare` hook: recalculates deductions whenever the gross amount changes. */
export async function preparePayslip(ctx: Ctx, data: Row, existing: Row | null): Promise<Row> {
  const employeeId = Number(data.employee_id ?? existing?.employee_id);
  const employee = await ctx.db.first<EmployeeRow>("SELECT * FROM employees WHERE id = ?", employeeId);
  if (!employee) throw new AppError("validation", "Employee not found.", { employee_id: "Unknown employee" });
  const gross = Number(data.gross ?? existing?.gross ?? employee.monthly_salary);
  return { ...data, ...payslipValues(employee, gross) };
}

export async function finalizePayslip(ctx: Ctx, record: Row): Promise<void> {
  const slip = record as unknown as PayslipRow & Record<string, number>;
  if (slip.status !== "draft") throw new AppError("conflict", "Only draft payslips can be finalised.");
  const employee = await ctx.db.first<EmployeeRow>("SELECT * FROM employees WHERE id = ?", slip.employee_id);
  const [salaries, social, withholding, bank, socialExpense] = await Promise.all([
    accountIdByNumber(ctx, SYSTEM_ACCOUNTS.salaries),
    accountIdByNumber(ctx, SYSTEM_ACCOUNTS.socialSecurity),
    accountIdByNumber(ctx, SYSTEM_ACCOUNTS.withholdingTax),
    accountIdByNumber(ctx, SYSTEM_ACCOUNTS.bank),
    accountIdByNumber(ctx, SYSTEM_ACCOUNTS.socialSecurityExpense),
  ]);
  const name = employee ? `${employee.firstname} ${employee.lastname}` : `#${slip.employee_id}`;
  const label = `${String(slip.month).padStart(2, "0")}/${slip.year}`;
  const employeeSocial = slip.ahv + slip.alv + slip.bvg + slip.nbu + slip.ktg;
  const netSalary = slip.gross - employeeSocial - slip.withholding_tax;
  const employerShare = slip.employer_cost - slip.gross;
  const lines: EntryLineInput[] = [
    { debit_account_id: salaries, credit_account_id: social, amount: employeeSocial, description: `Employee contributions ${name}` },
    { debit_account_id: salaries, credit_account_id: withholding, amount: slip.withholding_tax, description: `Withholding tax ${name}` },
    { debit_account_id: salaries, credit_account_id: bank, amount: netSalary, description: `Net salary ${name}` },
    { debit_account_id: social, credit_account_id: bank, amount: slip.allowances, description: `Family allowances ${name}` },
    { debit_account_id: socialExpense, credit_account_id: social, amount: employerShare, description: `Employer contributions ${name}` },
  ].filter((l) => l.amount > 0);
  const entryId = await postEntry(ctx, {
    date: monthEnd(slip.year, slip.month),
    description: `Payroll ${label} – ${name}`,
    type: "payroll",
    sourceType: "payslip",
    sourceId: slip.id,
    lines,
  });
  await patchColumns(ctx, { table: "payslips" }, slip.id, { status: "final", journal_entry_id: entryId });
}

export async function revertPayslip(ctx: Ctx, record: Row): Promise<void> {
  const slip = record as unknown as PayslipRow;
  if (slip.journal_entry_id) await reverseEntry(ctx, slip.journal_entry_id, monthEnd(slip.year, slip.month), "Payslip reverted");
  await patchColumns(ctx, { table: "payslips" }, slip.id, { status: "draft", journal_entry_id: null });
}

/** Year-to-date totals per employee, the basis for the annual salary certificate (Lohnausweis). */
export async function salarySummary(ctx: Ctx, year: number) {
  return ctx.db.all<Row>(
    `SELECT e.id, e.nr, e.firstname, e.lastname, e.ahv_number,
            COUNT(p.id) AS months, SUM(p.gross) AS gross, SUM(p.ahv + p.alv) AS social,
            SUM(p.bvg) AS bvg, SUM(p.nbu + p.ktg) AS insurance, SUM(p.withholding_tax) AS withholding_tax,
            SUM(p.allowances) AS allowances, SUM(p.net) AS net, SUM(p.employer_cost) AS employer_cost
     FROM employees e JOIN payslips p ON p.employee_id = e.id AND p.year = ? AND p.status != 'draft'
     GROUP BY e.id ORDER BY e.lastname, e.firstname`,
    year,
  );
}
