import { audit } from "./audit";
import { uuid } from "./auth/crypto";
import { contentDisposition, safeFileName } from "./disposition";
import { fileFingerprint, flagDuplicates } from "./duplicates";
import type { Ctx } from "./ctx";
import type { Row } from "./resources/types";
import { AppError } from "./errors";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface FileRow {
  id: number;
  name: string;
  mime_type: string | null;
  size: number;
  storage_key: string;
  ref_type: string | null;
  ref_id: number | null;
  /** Content fingerprint: the same file always has the same one. */
  sha256: string | null;
  created_at: string;
}

function bucket(ctx: Ctx) {
  if (!ctx.files) throw new AppError("internal", "File storage (R2 binding FILES) is not configured.");
  return ctx.files;
}

/** Stores an upload in R2 under a tenant-scoped key and records it. */
export async function storeFile(
  ctx: Ctx,
  file: { name: string; type: string; bytes: ArrayBuffer },
  ref?: { type?: string | null; id?: number | null; description?: string | null },
): Promise<FileRow> {
  if (file.bytes.byteLength > MAX_FILE_BYTES) throw new AppError("validation", "Files must be smaller than 25 MB.");
  const safeName = safeFileName(file.name);
  const key = `${ctx.tenant.id}/${uuid()}/${safeName}`;
  const sha256 = await fileFingerprint(file.bytes);
  await bucket(ctx).put(key, file.bytes, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  const res = await ctx.db.run(
    `INSERT INTO files (name, mime_type, size, storage_key, ref_type, ref_id, description, sha256, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    safeName,
    file.type || null,
    file.bytes.byteLength,
    key,
    ref?.type ?? null,
    ref?.id ?? null,
    ref?.description ?? null,
    sha256,
    ctx.actor.name,
    ctx.actor.name,
  );
  await audit(ctx, { action: "upload", resource: "files", resourceId: res.lastRowId, summary: `Uploaded ${safeName}` });
  const row = (await ctx.db.first<FileRow>("SELECT * FROM files WHERE id = ?", res.lastRowId))!;
  await flagDuplicates(ctx, "files", row as unknown as Row);
  return row;
}

export async function fileResponse(ctx: Ctx, id: number, inline = true): Promise<Response> {
  const row = await ctx.db.first<FileRow>("SELECT * FROM files WHERE id = ?", id);
  if (!row) throw new AppError("not_found", "File not found.");
  if (!row.storage_key.startsWith(`${ctx.tenant.id}/`)) throw new AppError("forbidden", "File belongs to another company.");
  const object = await bucket(ctx).get(row.storage_key);
  if (!object) throw new AppError("not_found", "File content is missing from storage.");
  return new Response(object.body, {
    headers: {
      "Content-Type": row.mime_type ?? object.httpMetadata?.contentType ?? "application/octet-stream",
      "Content-Disposition": contentDisposition(row.name, inline),
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function deleteStoredObject(ctx: Ctx, key: string): Promise<void> {
  if (ctx.files && key.startsWith(`${ctx.tenant.id}/`)) await ctx.files.delete(key);
}

/** Loads a stored file's metadata and bytes (tenant-checked). */
export async function readFile(ctx: Ctx, id: number): Promise<{ row: FileRow & { anthropic_file_id?: string | null; sha256?: string | null }; bytes: Uint8Array }> {
  const row = await ctx.db.first<FileRow & { anthropic_file_id: string | null; sha256: string | null }>("SELECT * FROM files WHERE id = ?", id);
  if (!row) throw new AppError("not_found", "File not found.");
  if (!row.storage_key.startsWith(`${ctx.tenant.id}/`)) throw new AppError("forbidden", "File belongs to another company.");
  const object = await bucket(ctx).get(row.storage_key);
  if (!object) throw new AppError("not_found", "File content is missing from storage.");
  return { row, bytes: new Uint8Array(await object.arrayBuffer()) };
}

/** Links a file to a record (e.g. a scanned bill to its bill). */
export async function attachFile(ctx: Ctx, fileId: number, refType: string, refId: number): Promise<void> {
  await ctx.db.run("UPDATE files SET ref_type = ?, ref_id = ?, updated_at = ?, updated_by = ? WHERE id = ?", refType, refId, new Date().toISOString(), ctx.actor.name, fileId);
}

/**
 * Why a file must be kept: a receipt of a booked bill or expense, or an attachment of
 * a record that can no longer change (an issued invoice, a posted entry). Swiss law
 * (Art. 958f CO) keeps business records and their vouchers for ten years.
 */
export async function retentionReason(ctx: Ctx, file: Pick<FileRow, "id" | "ref_type" | "ref_id">): Promise<string | null> {
  const voucher = await ctx.db.first<{ nr: string | null }>(
    "SELECT nr FROM bills WHERE file_id = ? AND status != 'draft' UNION ALL SELECT nr FROM expenses WHERE file_id = ? AND status = 'booked' LIMIT 1",
    file.id,
    file.id,
  );
  if (voucher) return "This file is the receipt of a booked record and is kept for ten years (Art. 958f CO).";
  if (file.ref_type && file.ref_id) {
    const { getResource } = await import("./resources/registry");
    const { findRecord } = await import("./crud");
    const res = getResource(file.ref_type);
    const record = res ? await findRecord(ctx, res, Number(file.ref_id), false) : null;
    if (res && record && res.hooks?.lockReason?.(record)) return "This file belongs to a record that can no longer change and is kept for ten years (Art. 958f CO).";
  }
  return null;
}

