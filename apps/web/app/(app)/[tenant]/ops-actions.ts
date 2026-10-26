"use server";

import { revalidatePath } from "next/cache";
import { verifyAuditLog } from "@batzio/server/audit";
import { importStatements, parseCamt, parseCsv } from "@batzio/server/banking";
import { assertCan } from "@batzio/server/ctx";
import { errorText, toAppError } from "@batzio/server/errors";
import { getT } from "@/lib/i18n/server";
import { runPayroll } from "@batzio/server/payroll";
import { remindOverdue, runRecurring } from "@batzio/server/sales";
import { tenantCtx } from "@/lib/server/session";
import type { ActionResponse } from "./actions";

const fail = async (error: unknown): Promise<ActionResponse> => {
  const e = toAppError(error);
  return { ok: false, error: errorText(e, await getT()), fields: e.fields };
};

export async function remindOverdueAction(tenant: string): Promise<ActionResponse> {
  try {
    const ctx = await tenantCtx(tenant);
    assertCan(ctx, "sales", "write");
    const n = await remindOverdue(ctx);
    revalidatePath(`/${tenant}/reminders`);
    const t = await getT();
    return { ok: true, message: n ? t("{n} reminder(s) created.", { n }) : t("No overdue invoices need a reminder.") };
  } catch (e) {
    return fail(e);
  }
}

export async function runRecurringAction(tenant: string): Promise<ActionResponse> {
  try {
    const ctx = await tenantCtx(tenant);
    assertCan(ctx, "sales", "write");
    const ids = await runRecurring(ctx);
    revalidatePath(`/${tenant}/invoices`);
    const t = await getT();
    return { ok: true, message: ids.length ? t("{n} invoice(s) created from recurring orders.", { n: ids.length }) : t("No recurring invoices are due.") };
  } catch (e) {
    return fail(e);
  }
}

export async function runPayrollAction(tenant: string, year: number, month: number): Promise<ActionResponse> {
  try {
    const ctx = await tenantCtx(tenant);
    assertCan(ctx, "payroll", "write");
    const r = await runPayroll(ctx, year, month);
    revalidatePath(`/${tenant}/payslips`);
    const t = await getT();
    return { ok: true, message: r.skipped ? t("{n} payslip(s) created, {skipped} already existed.", { n: r.created, skipped: r.skipped }) : t("{n} payslip(s) created.", { n: r.created }), redirect: `/${tenant}/payslips?year=${year}&month=${month}` };
  } catch (e) {
    return fail(e);
  }
}

export async function verifyAuditAction(tenant: string): Promise<ActionResponse> {
  try {
    const ctx = await tenantCtx(tenant);
    assertCan(ctx, "audit", "read");
    const v = await verifyAuditLog(ctx);
    const t = await getT();
    return v.ok
      ? { ok: true, message: t("Audit chain intact: {n} entries verified.", { n: v.checked }) }
      : { ok: false, error: t("Audit chain broken at entry #{id} ({n} entries verified before).", { id: v.brokenAt ?? "?", n: v.checked }) };
  } catch (e) {
    return fail(e);
  }
}

export async function importStatementAction(tenant: string, form: FormData): Promise<ActionResponse> {
  try {
    const ctx = await tenantCtx(tenant);
    assertCan(ctx, "banking", "write");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return { ok: false, error: (await getT())("Choose a camt.053/054 or CSV file.") };
    const text = await file.text();
    const statements = /^\s*</.test(text) ? await parseCamt(text) : await parseCsv(text);
    const bankAccountId = Number(form.get("bank_account_id")) || null;
    const result = await importStatements(ctx, statements, { bankAccountId, autoBook: form.get("auto_book") === "on" });
    revalidatePath(`/${tenant}/bank_transactions`);
    return {
      ok: true,
      message: (await getT())("Bank statement: {imported} new lines, {matched} matched, {booked} booked.", { imported: result.imported, matched: result.suggested, booked: result.booked }),
      redirect: `/${tenant}/bank_transactions`,
    };
  } catch (e) {
    return fail(e);
  }
}
