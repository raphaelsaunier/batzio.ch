import { audit } from "./audit";
import { uuid } from "./auth/crypto";
import type { Ctx } from "./ctx";
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
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
  const key = `${ctx.tenant.id}/${uuid()}/${safeName}`;
  await bucket(ctx).put(key, file.bytes, { httpMetadata: { contentType: file.type || "application/octet-stream" } });
  const res = await ctx.db.run(
    `INSERT INTO files (name, mime_type, size, storage_key, ref_type, ref_id, description, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    safeName,
    file.type || null,
    file.bytes.byteLength,
    key,
    ref?.type ?? null,
    ref?.id ?? null,
    ref?.description ?? null,
    ctx.actor.name,
    ctx.actor.name,
  );
  await audit(ctx, { action: "upload", resource: "files", resourceId: res.lastRowId, summary: `Uploaded ${safeName}` });
  return (await ctx.db.first<FileRow>("SELECT * FROM files WHERE id = ?", res.lastRowId))!;
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
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${row.name.replace(/"/g, "")}"`,
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
