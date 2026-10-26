import { XMLParser } from "fast-xml-parser";
import { today } from "@batzio/core/format";
import { toCents } from "@batzio/core/money";
import { getResource } from "./resources/registry";
import { normalizeIban } from "@batzio/core/swiss/iban";
import { accountIdByNumber, postEntry } from "./accounting";
import { audit } from "./audit";
import { sha256Hex } from "./auth/crypto";
import { getRecord, patchColumns } from "./crud";
import type { Ctx } from "./ctx";
import { AppError } from "./errors";
import { markOutgoingPaid } from "./purchases";
import { recordPayment } from "./sales";
import { getSettings } from "./settings";

export interface ParsedTransaction {
  bookingDate: string;
  valueDate: string | null;
  /** Signed cents: positive = incoming. */
  amount: number;
  currency: string;
  counterparty: string | null;
  counterpartyIban: string | null;
  reference: string | null;
  remittance: string | null;
  externalId: string;
}

export interface ParsedStatement {
  iban: string | null;
  transactions: ParsedTransaction[];
}

const asArray = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"]);
  return String(v);
};
const dateOf = (v: unknown): string | null => {
  const o = v as { Dt?: unknown; DtTm?: unknown } | undefined;
  const raw = text(o?.Dt) ?? text(o?.DtTm);
  return raw ? raw.slice(0, 10) : null;
};

/** Parses ISO 20022 camt.053 (statement) and camt.054 (notification) files. */
export async function parseCamt(xml: string): Promise<ParsedStatement[]> {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, attributeNamePrefix: "@", parseTagValue: false });
  const doc = parser.parse(xml)?.Document;
  if (!doc) throw new AppError("validation", "Not an ISO 20022 camt document.");
  const container = doc.BkToCstmrStmt ?? doc.BkToCstmrDbtCdtNtfctn ?? doc.BkToCstmrAcctRpt;
  if (!container) throw new AppError("validation", "Unsupported camt message (expected camt.052, camt.053 or camt.054).");
  const statements = asArray(container.Stmt ?? container.Ntfctn ?? container.Rpt);

  const out: ParsedStatement[] = [];
  for (const stmt of statements) {
    const iban = text(stmt?.Acct?.Id?.IBAN);
    const transactions: ParsedTransaction[] = [];
    for (const [ei, entry] of asArray(stmt?.Ntry).entries()) {
      const sign = text(entry?.CdtDbtInd) === "DBIT" ? -1 : 1;
      const currency = String(entry?.Amt?.["@Ccy"] ?? "CHF");
      const bookingDate = dateOf(entry?.BookgDt) ?? today();
      const valueDate = dateOf(entry?.ValDt);
      const entryRef = text(entry?.AcctSvcrRef) ?? text(entry?.NtryRef);
      const details = asArray(entry?.NtryDtls).flatMap((d: { TxDtls?: unknown }) => asArray(d?.TxDtls as unknown[]));
      const items = details.length ? details : [null];
      for (const [ti, tx] of items.entries()) {
        const t = tx as Record<string, any> | null;
        const txAmount = t?.Amt ?? t?.AmtDtls?.TxAmt?.Amt;
        const amount = sign * toCents(text(txAmount ?? entry?.Amt) ?? 0);
        const parties = t?.RltdPties ?? {};
        const party = sign > 0 ? (parties.Dbtr ?? parties.UltmtDbtr) : (parties.Cdtr ?? parties.UltmtCdtr);
        const partyAcct = sign > 0 ? parties.DbtrAcct : parties.CdtrAcct;
        const strd = asArray(t?.RmtInf?.Strd)[0] as Record<string, any> | undefined;
        const reference = text(strd?.CdtrRefInf?.Ref);
        const ustrd = asArray(t?.RmtInf?.Ustrd).map(text).filter(Boolean).join(" ") || text(entry?.AddtlNtryInf);
        const externalId =
          text(t?.Refs?.AcctSvcrRef) ??
          text(t?.Refs?.EndToEndId) ??
          (entryRef ? `${entryRef}-${ti}` : await sha256Hex(`${bookingDate}|${amount}|${ei}|${ti}|${ustrd ?? ""}`));
        transactions.push({
          bookingDate,
          valueDate,
          amount,
          currency,
          counterparty: text(party?.Nm ?? party?.Pty?.Nm),
          counterpartyIban: text(partyAcct?.Id?.IBAN),
          reference: reference ? reference.replace(/\s+/g, "") : null,
          remittance: ustrd ?? null,
          externalId,
        });
      }
    }
    out.push({ iban: iban ? normalizeIban(iban) : null, transactions });
  }
  return out;
}

/** Parses a simple CSV export: date;amount;description[;reference] (ISO or dd.mm.yyyy dates). */
export async function parseCsv(csv: string): Promise<ParsedStatement[]> {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const transactions: ParsedTransaction[] = [];
  for (const [i, line] of lines.entries()) {
    const sep = line.includes(";") ? ";" : ",";
    const cols = line.split(sep).map((c) => c.replace(/^"|"$/g, "").trim());
    const [rawDate, rawAmount, description, reference] = cols;
    const date = /^\d{2}\.\d{2}\.\d{4}$/.test(rawDate)
      ? `${rawDate.slice(6)}-${rawDate.slice(3, 5)}-${rawDate.slice(0, 2)}`
      : /^\d{4}-\d{2}-\d{2}/.test(rawDate)
        ? rawDate.slice(0, 10)
        : null;
    if (!date || rawAmount === undefined || Number.isNaN(Number(rawAmount.replace(/['’]/g, "")))) continue; // header or junk
    const amount = toCents(rawAmount.replace(/['’]/g, ""));
    transactions.push({
      bookingDate: date,
      valueDate: null,
      amount,
      currency: "CHF",
      counterparty: null,
      counterpartyIban: null,
      reference: reference?.replace(/\s+/g, "") || null,
      remittance: description || null,
      externalId: await sha256Hex(`${i}|${line}`),
    });
  }
  return [{ iban: null, transactions }];
}

interface BankAccountRow {
  id: number;
  name: string;
  iban: string | null;
  qr_iban: string | null;
  bic: string | null;
  account_id: number | null;
  currency_code: string;
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  suggested: number;
  booked: number;
}

/** Imports parsed statements, de-duplicates by bank reference and auto-matches. */
export async function importStatements(
  ctx: Ctx,
  statements: ParsedStatement[],
  options: { bankAccountId?: number | null; autoBook?: boolean } = {},
): Promise<ImportResult> {
  const banks = await ctx.db.all<BankAccountRow>("SELECT * FROM bank_accounts");
  const batch = `import-${Date.now()}`;
  const result: ImportResult = { imported: 0, duplicates: 0, suggested: 0, booked: 0 };

  for (const stmt of statements) {
    const bank =
      (options.bankAccountId ? banks.find((b) => b.id === options.bankAccountId) : undefined) ??
      banks.find((b) => stmt.iban && (normalizeIban(b.iban) === stmt.iban || normalizeIban(b.qr_iban) === stmt.iban)) ??
      banks[0];
    if (!bank) throw new AppError("validation", "Create a bank account before importing statements.");
    for (const tx of stmt.transactions) {
      const res = await ctx.db.run(
        `INSERT OR IGNORE INTO bank_transactions (bank_account_id, booking_date, value_date, amount, currency_code, counterparty, counterparty_iban, reference, remittance, external_id, import_batch, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        bank.id,
        tx.bookingDate,
        tx.valueDate,
        tx.amount,
        tx.currency,
        tx.counterparty,
        tx.counterpartyIban,
        tx.reference,
        tx.remittance,
        tx.externalId,
        batch,
        ctx.actor.name,
        ctx.actor.name,
      );
      if (!res.changes) {
        result.duplicates++;
        continue;
      }
      result.imported++;
      const match = await suggestMatch(ctx, res.lastRowId);
      if (match) {
        result.suggested++;
        if (options.autoBook && match.exact) {
          await bookTransaction(ctx, res.lastRowId, { type: match.type, id: match.id });
          result.booked++;
        }
      }
    }
  }
  await audit(ctx, {
    action: "import",
    resource: "bank_transactions",
    summary: `Imported ${result.imported} bank transactions (${result.duplicates} duplicates, ${result.suggested} matched)`,
  });
  return result;
}

interface TxRow {
  id: number;
  bank_account_id: number;
  booking_date: string;
  amount: number;
  currency_code: string;
  counterparty: string | null;
  counterparty_iban: string | null;
  reference: string | null;
  remittance: string | null;
  status: string;
  match_type: string | null;
  match_id: number | null;
}

/** Finds the most likely counterpart for a transaction and stores it as suggestion. */
export async function suggestMatch(ctx: Ctx, txId: number): Promise<{ type: "invoice" | "outgoing_payment"; id: number; exact: boolean } | null> {
  const tx = await ctx.db.first<TxRow>("SELECT * FROM bank_transactions WHERE id = ?", txId);
  if (!tx || tx.status === "booked") return null;
  let match: { type: "invoice" | "outgoing_payment"; id: number; exact: boolean } | null = null;

  if (tx.amount > 0) {
    if (tx.reference) {
      const inv = await ctx.db.first<{ id: number; amount_open: number }>(
        "SELECT id, amount_open FROM documents WHERE kind = 'invoice' AND status IN ('open','partial') AND qr_reference = ?",
        tx.reference,
      );
      if (inv) match = { type: "invoice", id: inv.id, exact: inv.amount_open >= tx.amount };
    }
    if (!match) {
      const text = `${tx.remittance ?? ""} ${tx.reference ?? ""}`;
      const candidates = await ctx.db.all<{ id: number; nr: string | null; amount_open: number }>(
        "SELECT id, nr, amount_open FROM documents WHERE kind = 'invoice' AND status IN ('open','partial') AND amount_open = ?",
        tx.amount,
      );
      const byNumber = candidates.find((c) => c.nr && text.includes(c.nr));
      const pick = byNumber ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (pick) match = { type: "invoice", id: pick.id, exact: !!byNumber };
    }
  } else {
    const candidates = await ctx.db.all<{ id: number; iban: string | null }>(
      "SELECT id, iban FROM outgoing_payments WHERE status IN ('open','exported') AND amount = ? AND bank_account_id = ?",
      -tx.amount,
      tx.bank_account_id,
    );
    const pick =
      candidates.find((c) => c.iban && tx.counterparty_iban && normalizeIban(c.iban) === normalizeIban(tx.counterparty_iban)) ??
      (candidates.length === 1 ? candidates[0] : undefined);
    if (pick) match = { type: "outgoing_payment", id: pick.id, exact: !!tx.counterparty_iban };
  }

  if (match) {
    await patchColumns(ctx, { table: "bank_transactions" }, tx.id, { status: "suggested", match_type: match.type, match_id: match.id });
  }
  return match;
}

export interface BookTarget {
  type: "invoice" | "outgoing_payment" | "account";
  id?: number | null;
  account_id?: number | null;
  tax_id?: number | null;
  description?: string | null;
}

export async function bookTransaction(ctx: Ctx, txId: number, target: BookTarget): Promise<void> {
  const tx = await ctx.db.first<TxRow>("SELECT * FROM bank_transactions WHERE id = ?", txId);
  if (!tx) throw new AppError("not_found", "Transaction not found.");
  if (tx.status === "booked") throw new AppError("conflict", "Transaction is already booked.");
  const bank = await ctx.db.first<BankAccountRow>("SELECT * FROM bank_accounts WHERE id = ?", tx.bank_account_id);
  const ledger = bank?.account_id ?? (await accountIdByNumber(ctx, "1020"));
  let entryId: number | null = null;

  if (target.type === "invoice") {
    if (!target.id) throw new AppError("validation", "Select an invoice.");
    if (tx.amount <= 0) throw new AppError("validation", "Only incoming payments can settle invoices.");
    const record = await getRecord(ctx, getResource("invoices")!, target.id);
    const open = Number(record.amount_open);
    const doc = await recordPayment(ctx, record, {
      date: tx.booking_date,
      amount: Math.min(tx.amount, open),
      bank_account_id: tx.bank_account_id,
      title: tx.remittance ?? tx.counterparty ?? "Bank payment",
      bank_transaction_id: tx.id,
    });
    entryId = (await ctx.db.value<number>(
      "SELECT journal_entry_id FROM document_payments WHERE bank_transaction_id = ? ORDER BY id DESC LIMIT 1",
      tx.id,
    )) ?? null;
    void doc;
  } else if (target.type === "outgoing_payment") {
    if (!target.id) throw new AppError("validation", "Select a payment.");
    const payment = await ctx.db.first("SELECT * FROM outgoing_payments WHERE id = ?", target.id);
    if (!payment) throw new AppError("not_found", "Payment not found.");
    await markOutgoingPaid(ctx, payment, tx.booking_date);
    entryId = await ctx.db.value<number>("SELECT journal_entry_id FROM outgoing_payments WHERE id = ?", target.id);
  } else {
    if (!target.account_id) throw new AppError("validation", "Select a contra account.", { account_id: "Required" });
    const incoming = tx.amount > 0;
    entryId = await postEntry(ctx, {
      date: tx.booking_date,
      description: target.description ?? tx.remittance ?? tx.counterparty ?? "Bank transaction",
      type: "bank",
      sourceType: "bank_transaction",
      sourceId: tx.id,
      lines: [
        {
          debit_account_id: incoming ? ledger : target.account_id,
          credit_account_id: incoming ? target.account_id : ledger,
          amount: Math.abs(tx.amount),
          tax_id: target.tax_id ?? null,
          description: target.description ?? tx.remittance ?? null,
        },
      ],
    });
  }
  await patchColumns(ctx, { table: "bank_transactions" }, tx.id, {
    status: "booked",
    match_type: target.type,
    match_id: target.id ?? target.account_id ?? null,
    journal_entry_id: entryId,
  });
}

// --------------------------------------------------------------- pain.001

const xmlEscape = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
/** SPS allows a restricted Latin character set; strip anything else. */
const spsText = (v: string | null | undefined, max = 70) =>
  xmlEscape(
    (v ?? "")
      .normalize("NFC")
      .replace(/[^A-Za-z0-9 .,:'+\-/()?&;!"#%*=<>@\[\]{}^_`|~$£€äöüÄÖÜàâæçéèêëîïôœùûüÿÀÂÆÇÉÈÊËÎÏÔŒÙÛÜŸßñÑ]/g, " ")
      .trim()
      .slice(0, max),
  );

interface PainPayment {
  id: number;
  execution_date: string;
  amount: number;
  currency_code: string;
  recipient_name: string | null;
  iban: string | null;
  qr_reference: string | null;
  message: string | null;
  contact_id: number | null;
}

/** Generates a Swiss Payment Standards pain.001.001.09 credit transfer file. */
export async function exportPain001(ctx: Ctx, bankAccountId: number, paymentIds?: number[]): Promise<{ xml: string; count: number; filename: string }> {
  const bank = await ctx.db.first<BankAccountRow>("SELECT * FROM bank_accounts WHERE id = ?", bankAccountId);
  if (!bank?.iban) throw new AppError("validation", "The bank account needs an IBAN.");
  const company = await getSettings(ctx, "company");
  const rows = await ctx.db.all<PainPayment>(
    `SELECT * FROM outgoing_payments WHERE status = 'open' AND bank_account_id = ?${paymentIds?.length ? ` AND id IN (${paymentIds.map(() => "?").join(",")})` : ""} ORDER BY execution_date, id`,
    bankAccountId,
    ...(paymentIds ?? []),
  );
  const payments = rows.filter((p) => p.iban);
  if (!payments.length) throw new AppError("conflict", "There are no open payments with an IBAN for this bank account.");

  const contacts = new Map<number, Record<string, string | null>>();
  for (const p of payments) {
    if (p.contact_id && !contacts.has(p.contact_id)) {
      const c = await ctx.db.first<Record<string, string | null>>("SELECT * FROM contacts WHERE id = ?", p.contact_id);
      if (c) contacts.set(p.contact_id, c);
    }
  }
  const msgId = `BZ${Date.now()}`;
  const total = (list: PainPayment[]) => (list.reduce((s, p) => s + p.amount, 0) / 100).toFixed(2);
  const byDate = new Map<string, PainPayment[]>();
  for (const p of payments) byDate.set(p.execution_date, [...(byDate.get(p.execution_date) ?? []), p]);

  const address = (a: { street?: string | null; house_number?: string | null; postcode?: string | null; city?: string | null; country_code?: string | null }) =>
    `<PstlAdr>${a.street ? `<StrtNm>${spsText(a.street)}</StrtNm>` : ""}${a.house_number ? `<BldgNb>${spsText(a.house_number, 16)}</BldgNb>` : ""}${a.postcode ? `<PstCd>${spsText(a.postcode, 16)}</PstCd>` : ""}<TwnNm>${spsText(a.city || "-", 35)}</TwnNm><Ctry>${spsText(a.country_code || "CH", 2)}</Ctry></PstlAdr>`;

  const blocks = [...byDate.entries()].map(([date, list], bi) => {
    const txs = list
      .map((p) => {
        const ref = p.qr_reference?.replace(/\s+/g, "");
        const remittance = ref
          ? `<RmtInf><Strd><CdtrRefInf><Tp><CdOrPrtry>${ref.startsWith("RF") ? "<Cd>SCOR</Cd>" : "<Prtry>QRR</Prtry>"}</CdOrPrtry></Tp><Ref>${xmlEscape(ref)}</Ref></CdtrRefInf></Strd></RmtInf>`
          : p.message
            ? `<RmtInf><Ustrd>${spsText(p.message, 140)}</Ustrd></RmtInf>`
            : "";
        const c = p.contact_id ? contacts.get(p.contact_id) : undefined;
        return `<CdtTrfTxInf><PmtId><InstrId>BZ-${p.id}</InstrId><EndToEndId>BZ-${p.id}</EndToEndId></PmtId><Amt><InstdAmt Ccy="${xmlEscape(p.currency_code)}">${(p.amount / 100).toFixed(2)}</InstdAmt></Amt><Cdtr><Nm>${spsText(p.recipient_name || "Unknown")}</Nm>${c ? address(c) : ""}</Cdtr><CdtrAcct><Id><IBAN>${normalizeIban(p.iban)}</IBAN></Id></CdtrAcct>${remittance}</CdtTrfTxInf>`;
      })
      .join("");
    return `<PmtInf><PmtInfId>${msgId}-${bi + 1}</PmtInfId><PmtMtd>TRF</PmtMtd><BtchBookg>true</BtchBookg><NbOfTxs>${list.length}</NbOfTxs><CtrlSum>${total(list)}</CtrlSum><ReqdExctnDt><Dt>${date < today() ? today() : date}</Dt></ReqdExctnDt><Dbtr><Nm>${spsText(company.name || "Company")}</Nm>${address(company)}</Dbtr><DbtrAcct><Id><IBAN>${normalizeIban(bank.iban)}</IBAN></Id></DbtrAcct><DbtrAgt><FinInstnId>${bank.bic ? `<BICFI>${xmlEscape(bank.bic)}</BICFI>` : "<Othr><Id>NOTPROVIDED</Id></Othr>"}</FinInstnId></DbtrAgt>${txs}</PmtInf>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn><GrpHdr><MsgId>${msgId}</MsgId><CreDtTm>${new Date().toISOString().slice(0, 19)}</CreDtTm><NbOfTxs>${payments.length}</NbOfTxs><CtrlSum>${total(payments)}</CtrlSum><InitgPty><Nm>${spsText(company.name || "Company")}</Nm></InitgPty></GrpHdr>${blocks.join("")}</CstmrCdtTrfInitn></Document>
`;
  await ctx.db.batch(
    payments.map((p) => ({
      sql: "UPDATE outgoing_payments SET status = 'exported', exported_at = ?, updated_by = ? WHERE id = ?",
      params: [new Date().toISOString(), ctx.actor.name, p.id],
    })),
  );
  await audit(ctx, { action: "export_pain001", resource: "outgoing_payments", summary: `Exported ${payments.length} payments (pain.001)` });
  return { xml, count: payments.length, filename: `payments-${today()}.xml` };
}
