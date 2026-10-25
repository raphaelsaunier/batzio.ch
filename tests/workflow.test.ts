import { beforeAll, describe, expect, it } from "vitest";
import { getResource } from "@/lib/resources/registry";
import { balanceSheet, incomeStatement, trialBalance, vatReport } from "@/lib/server/accounting";
import { verifyAuditLog } from "@/lib/server/audit";
import { parseCamt } from "@/lib/server/banking";
import { createRecord, getRecord, listRecords, runAction, updateRecord } from "@/lib/server/crud";
import type { Ctx } from "@/lib/server/ctx";
import { seedDemo } from "@/lib/server/seed";
import { makeCtx } from "./helpers/tenant";

let ctx: Ctx;
const year = new Date().getUTCFullYear();

beforeAll(async () => {
  ctx = await makeCtx();
  await seedDemo(ctx);
});

describe("demo company", () => {
  it("keeps the ledger balanced", async () => {
    const tb = await trialBalance(ctx, `${year}-01-01`, `${year}-12-31`);
    expect(tb.totals.debit).toBe(tb.totals.credit);
    const bs = await balanceSheet(ctx, `${year}-12-31`);
    expect(bs.balanced).toBe(true);
  });

  it("books invoices with exact VAT", async () => {
    const invoices = await listRecords(ctx, getResource("invoices")!, { filters: { status_ne: "draft" } });
    const docVat = invoices.rows.reduce((s, r) => s + Number(r.total_vat), 0);
    const vat = await vatReport(ctx, `${year}-01-01`, `${year}-12-31`);
    const salesVat = vat.lines.filter((l) => l.type === "sales").reduce((s, l) => s + l.tax, 0);
    expect(salesVat).toBe(docVat);
    expect(vat.digits["399"]).toBe(salesVat);
    expect(vat.digits["479"]).toBeGreaterThan(0);
  });

  it("tracks payment status", async () => {
    const all = await listRecords(ctx, getResource("invoices")!, { limit: 50 });
    const statuses = [...new Set(all.rows.map((r) => r.status))].sort();
    expect(statuses).toEqual(["draft", "open", "paid", "partial"]);
  });

  it("suggests bank matches by QR reference and books them", async () => {
    const txs = await listRecords(ctx, getResource("bank_transactions")!, { filters: { status: "suggested" } });
    expect(txs.rows).toHaveLength(1);
    await runAction(ctx, getResource("bank_transactions")!, Number(txs.rows[0].id), "book_suggestion");
    const inv = await getRecord(ctx, getResource("invoices")!, Number(txs.rows[0].match_id));
    expect(inv.status).toBe("paid");
  });

  it("produces an income statement with a result", async () => {
    const pl = await incomeStatement(ctx, `${year}-01-01`, `${year}-12-31`);
    expect(pl.sections.length).toBeGreaterThan(2);
    expect(typeof pl.result?.amount).toBe("number");
  });

  it("locks issued documents and supports revert", async () => {
    const res = getResource("invoices")!;
    const draft = await createRecord(ctx, res, { contact_id: 1, positions: [{ type: "custom", text: "Test", quantity: 2, unit_price: 50 }] });
    expect(draft.total).toBe(10810);
    await runAction(ctx, res, Number(draft.id), "issue");
    await expect(updateRecord(ctx, res, Number(draft.id), { title: "x" })).rejects.toThrow(/drafts/);
    await runAction(ctx, res, Number(draft.id), "revert_to_draft");
    const reverted = await updateRecord(ctx, res, Number(draft.id), { title: "Edited" });
    expect(reverted.title).toBe("Edited");
  });

  it("keeps a valid hash-chained audit log", async () => {
    const v = await verifyAuditLog(ctx);
    expect(v.ok).toBe(true);
    expect(v.checked).toBeGreaterThan(20);
    await ctx.db.run("UPDATE audit_log SET summary = 'tampered' WHERE id = 3");
    const broken = await verifyAuditLog(ctx);
    expect(broken.ok).toBe(false);
    expect(broken.brokenAt).toBe(3);
  });
});

describe("camt.053", () => {
  it("parses entries with structured references", async () => {
    const xml = `<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt><Acct><Id><IBAN>CH9300762011623852957</IBAN></Id></Acct>
      <Ntry><Amt Ccy="CHF">1949.75</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-10-20</Dt></BookgDt><ValDt><Dt>2026-10-20</Dt></ValDt><AcctSvcrRef>ABC123</AcctSvcrRef>
      <NtryDtls><TxDtls><Refs><AcctSvcrRef>TX1</AcctSvcrRef></Refs><Amt Ccy="CHF">1949.75</Amt><RltdPties><Dbtr><Pty><Nm>Muster AG</Nm></Pty></Dbtr><DbtrAcct><Id><IBAN>CH5604835012345678009</IBAN></Id></DbtrAcct></RltdPties>
      <RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry><Prtry>QRR</Prtry></CdOrPrtry></Tp><Ref>210000000003139471430009017</Ref></CdtrRefInf></Strd></RmtInf></TxDtls></NtryDtls></Ntry>
      <Ntry><Amt Ccy="CHF">15.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-10-21</Dt></BookgDt><AddtlNtryInf>Fees</AddtlNtryInf></Ntry>
      </Stmt></BkToCstmrStmt></Document>`;
    const [stmt] = await parseCamt(xml);
    expect(stmt.iban).toBe("CH9300762011623852957");
    expect(stmt.transactions).toHaveLength(2);
    expect(stmt.transactions[0]).toMatchObject({ amount: 194975, reference: "210000000003139471430009017", counterparty: "Muster AG", externalId: "TX1" });
    expect(stmt.transactions[1]).toMatchObject({ amount: -1500, remittance: "Fees" });
  });
});

describe("supplier payments", () => {
  it("schedules a bill payment and exports a pain.001 file", async () => {
    const bills = getResource("bills")!;
    const booked = (await listRecords(ctx, bills, { filters: { status: "booked" } })).rows[0];
    expect(booked).toBeTruthy();
    const result = await runAction(ctx, bills, Number(booked.id), "schedule_payment", {});
    expect(result.redirect?.resource).toBe("outgoing_payments");
    const bank = await ctx.db.value<number>("SELECT id FROM bank_accounts WHERE is_default = 1");
    const { exportPain001 } = await import("@/lib/server/banking");
    const file = await exportPain001(ctx, bank!);
    expect(file.count).toBe(1);
    expect(file.xml).toContain("urn:iso:std:iso:20022:tech:xsd:pain.001.001.09");
    expect(file.xml).toContain("<IBAN>CH5604835012345678009</IBAN>");
    expect(file.xml).toMatch(/<InstdAmt Ccy="CHF">\d+\.\d{2}<\/InstdAmt>/);
    const payment = await getRecord(ctx, getResource("outgoing_payments")!, result.redirect!.id);
    expect(payment.status).toBe("exported");
    await runAction(ctx, getResource("outgoing_payments")!, Number(payment.id), "mark_paid", { date: "2026-10-20" });
    expect((await getRecord(ctx, bills, Number(booked.id))).status).toBe("paid");
  });

  it("invoices unbilled project time", async () => {
    const projects = getResource("projects")!;
    const project = (await listRecords(ctx, projects, {})).rows[0];
    const result = await runAction(ctx, projects, Number(project.id), "invoice_time", {});
    const invoice = await getRecord(ctx, getResource("invoices")!, result.redirect!.id);
    expect((invoice.positions as unknown[]).length).toBeGreaterThan(0);
    expect(Number(invoice.total)).toBeGreaterThan(0);
    const unbilled = await ctx.db.value<number>("SELECT COUNT(*) FROM timesheets WHERE project_id = ? AND status != 'billed'", project.id);
    expect(unbilled).toBe(0);
  });

  it("closes a business year and locks its bookings", async () => {
    const years = getResource("business_years")!;
    const y = (await listRecords(ctx, years, {})).rows[0];
    await runAction(ctx, years, Number(y.id), "close");
    const pl = await incomeStatement(ctx, String(y.start_date), String(y.end_date));
    expect(pl.result?.amount).not.toBe(0);
    const bs = await balanceSheet(ctx, String(y.end_date));
    expect(bs.balanced).toBe(true);
    await expect(createRecord(ctx, getResource("journal_entries")!, {
      date: String(y.end_date),
      description: "Late booking",
      lines: [{ debit_account_id: 1, credit_account_id: 2, amount: 10 }],
    })).rejects.toThrow(/closed/);
  });
});
