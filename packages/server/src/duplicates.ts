import { audit } from "./audit";
import { sha256Hex } from "./auth/crypto";
import { assertCan, type Ctx } from "./ctx";
import { AppError } from "./errors";
import { getResource, listResources } from "./resources/registry";
import type { Row } from "./resources/types";

/**
 * The same receipt dropped twice, a supplier bill entered again, a customer
 * created a second time: duplicates are flagged when a record is created (and
 * by a scan), then merged, removed or dismissed by a person.
 */

export type DuplicateReason =
  | "same_file"
  | "same_reference"
  | "same_supplier_number"
  | "same_amount_date"
  | "same_email"
  | "same_uid"
  | "same_name";

export interface DuplicateMatch {
  originalId: number;
  reason: DuplicateReason;
  score: number;
}

/** Resources checked for duplicates. */
export const DUPLICATE_RESOURCES = ["contacts", "bills", "expenses", "files"] as const;

const LEGAL_FORMS = /\b(ag|sa|gmbh|sàrl|sarl|sagl|kg|klg|ltd|llc|inc|gmbh & co\.? kg|genossenschaft|coop|verein|association|stiftung|fondation)\b\.?/g;

/** "Bergsicht Hotels AG" and "BERGSICHT-HOTELS ag." are the same company. */
export function normalizeName(...parts: unknown[]): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(LEGAL_FORMS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const digits = (v: unknown) => String(v ?? "").replace(/\D+/g, "");
const compact = (v: unknown) => String(v ?? "").replace(/[^A-Za-z0-9]+/g, "").toUpperCase();

/** SHA-256 of a file's bytes, hex — the same file always has the same fingerprint. */
export async function fileFingerprint(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function fileHash(ctx: Ctx, fileId: unknown): Promise<string | null> {
  if (!fileId) return null;
  return (await ctx.db.value<string>("SELECT sha256 FROM files WHERE id = ?", Number(fileId))) ?? null;
}

/** Earlier records that look like `record`, best match first. */
export async function findDuplicates(ctx: Ctx, resource: string, record: Row): Promise<DuplicateMatch[]> {
  const id = Number(record.id);
  const found = new Map<number, DuplicateMatch>();
  const add = (rows: { id: number }[], reason: DuplicateReason, score: number) => {
    for (const r of rows) {
      const prev = found.get(r.id);
      if (r.id !== id && (!prev || prev.score < score)) found.set(r.id, { originalId: r.id, reason, score });
    }
  };

  switch (resource) {
    case "contacts": {
      if (record.email) add(await ctx.db.all("SELECT id FROM contacts WHERE id < ? AND archived_at IS NULL AND lower(email) = lower(?)", id, String(record.email).trim()), "same_email", 95);
      const uid = digits(record.vat_number);
      if (uid.length >= 9) {
        const rows = await ctx.db.all<{ id: number; vat_number: string }>("SELECT id, vat_number FROM contacts WHERE id < ? AND archived_at IS NULL AND vat_number IS NOT NULL AND vat_number != ''", id);
        add(rows.filter((r) => digits(r.vat_number) === uid), "same_uid", 100);
      }
      const name = normalizeName(record.name_1, record.name_2);
      if (name.length >= 3) {
        const rows = await ctx.db.all<{ id: number; name_1: string; name_2: string | null }>(
          "SELECT id, name_1, name_2 FROM contacts WHERE id < ? AND archived_at IS NULL AND type = ? AND substr(lower(name_1), 1, 2) = substr(lower(?), 1, 2)",
          id,
          record.type ?? "company",
          String(record.name_1 ?? ""),
        );
        add(rows.filter((r) => normalizeName(r.name_1, r.name_2) === name), "same_name", 80);
      }
      break;
    }
    case "bills": {
      const ref = compact(record.qr_reference);
      if (ref.length >= 10) {
        const rows = await ctx.db.all<{ id: number; qr_reference: string }>("SELECT id, qr_reference FROM bills WHERE id < ? AND qr_reference IS NOT NULL AND qr_reference != ''", id);
        add(rows.filter((r) => compact(r.qr_reference) === ref), "same_reference", 100);
      }
      if (record.contact_id && record.vendor_nr) {
        const rows = await ctx.db.all<{ id: number; vendor_nr: string }>("SELECT id, vendor_nr FROM bills WHERE id < ? AND contact_id = ? AND vendor_nr IS NOT NULL", id, record.contact_id);
        add(rows.filter((r) => compact(r.vendor_nr) === compact(record.vendor_nr)), "same_supplier_number", 100);
      }
      if (record.contact_id && record.total && record.date) {
        add(
          await ctx.db.all("SELECT id FROM bills WHERE id < ? AND contact_id = ? AND total = ? AND abs(julianday(date) - julianday(?)) <= 3", id, record.contact_id, record.total, record.date),
          "same_amount_date",
          85,
        );
      }
      const hash = await fileHash(ctx, record.file_id);
      if (hash) add(await ctx.db.all("SELECT b.id FROM bills b JOIN files f ON f.id = b.file_id WHERE b.id < ? AND f.sha256 = ?", id, hash), "same_file", 100);
      break;
    }
    case "expenses": {
      if (record.amount && record.date) {
        const rows = await ctx.db.all<{ id: number; title: string; contact_id: number | null }>("SELECT id, title, contact_id FROM expenses WHERE id < ? AND amount = ? AND date = ?", id, record.amount, record.date);
        add(rows.filter((r) => (record.contact_id && r.contact_id === record.contact_id) || normalizeName(r.title) === normalizeName(record.title)), "same_amount_date", 85);
      }
      const hash = await fileHash(ctx, record.file_id);
      if (hash) add(await ctx.db.all("SELECT e.id FROM expenses e JOIN files f ON f.id = e.file_id WHERE e.id < ? AND f.sha256 = ?", id, hash), "same_file", 100);
      break;
    }
    case "files": {
      if (record.sha256) add(await ctx.db.all("SELECT id FROM files WHERE id < ? AND sha256 = ?", id, record.sha256), "same_file", 100);
      break;
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score || a.originalId - b.originalId);
}

/** Flags the best match of a freshly created record; never blocks the creation itself. */
export async function flagDuplicates(ctx: Ctx, resource: string, record: Row): Promise<DuplicateMatch | null> {
  if (!(DUPLICATE_RESOURCES as readonly string[]).includes(resource)) return null;
  const [best] = await findDuplicates(ctx, resource, record);
  if (!best) return null;
  await ctx.db.run(
    "INSERT OR IGNORE INTO duplicates (resource, record_id, original_id, reason, score, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
    resource,
    Number(record.id),
    best.originalId,
    best.reason,
    best.score,
    ctx.actor.name,
    ctx.actor.name,
  );
  return best;
}

/** Looks through everything already in Batzio (after moving in, for instance). */
export async function scanDuplicates(ctx: Ctx): Promise<number> {
  let flagged = 0;
  for (const resource of DUPLICATE_RESOURCES) {
    const res = getResource(resource);
    if (!res) continue;
    const rows = await ctx.db.all<Row>(`SELECT * FROM ${res.table} ORDER BY id`);
    for (const row of rows) {
      if (row.archived_at) continue;
      const before = await ctx.db.value<number>("SELECT COUNT(*) FROM duplicates WHERE resource = ? AND record_id = ?", resource, row.id);
      if (before) continue;
      if (await flagDuplicates(ctx, resource, row)) flagged++;
    }
  }
  return flagged;
}

/**
 * Folds a duplicate contact into the original: every document, bill, project,
 * contact person and file that pointed to the copy now points to the original,
 * then the copy is archived. Recorded in the audit log.
 */
export async function mergeContacts(ctx: Ctx, keepId: number, dropId: number): Promise<void> {
  assertCan(ctx, "contacts", "write");
  if (keepId === dropId) throw new AppError("validation", "A contact cannot be merged into itself.");
  const contacts = getResource("contacts")!;
  for (const id of [keepId, dropId]) {
    if (!(await ctx.db.value("SELECT id FROM contacts WHERE id = ?", id))) throw new AppError("not_found", "{label} #{id} not found.", undefined, { label: contacts.label, id });
  }
  // Every column anywhere that references a contact, each table once.
  const columns = new Set<string>();
  for (const res of listResources()) {
    for (const f of res.fields) if (f.type === "ref" && f.ref === "contacts") columns.add(`${res.table}.${f.name}`);
    for (const child of res.children ?? []) for (const f of child.fields) if (f.type === "ref" && f.ref === "contacts") columns.add(`${child.table}.${f.name}`);
  }
  const statements: { sql: string; params: unknown[] }[] = [...columns].map((c) => {
    const [table, column] = c.split(".");
    return { sql: `UPDATE "${table}" SET "${column}" = ? WHERE "${column}" = ?`, params: [keepId, dropId] };
  });
  statements.push({ sql: "UPDATE files SET ref_id = ? WHERE ref_type = 'contacts' AND ref_id = ?", params: [keepId, dropId] });
  statements.push({ sql: "UPDATE contacts SET archived_at = ?, updated_at = ?, updated_by = ? WHERE id = ?", params: [new Date().toISOString(), new Date().toISOString(), ctx.actor.name, dropId] });
  statements.push({ sql: "UPDATE duplicates SET status = 'resolved', updated_at = ?, updated_by = ? WHERE resource = 'contacts' AND (record_id = ? OR original_id = ?) AND status = 'open'", params: [new Date().toISOString(), ctx.actor.name, dropId, dropId] });
  await ctx.db.batch(statements);
  await audit(ctx, { action: "merge", resource: "contacts", resourceId: keepId, summary: `Merged contact #${dropId} into #${keepId}`, changes: { merged: dropId } });
}
