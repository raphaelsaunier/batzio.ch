import { deleteStoredObject, retentionReason } from "../../files";
import { undoChange } from "../../history";
import { mergeContacts } from "../../duplicates";
import { assertCan } from "../../ctx";
import { deleteRecord } from "../../crud";
import { AppError } from "../../errors";
import { audit } from "../../audit";
import { getResource } from "../registry";
import { defineResource } from "../define";
import { f, opt } from "../fields";
import type { ResourceDef } from "../types";

export const systemResources: ResourceDef[] = [
  defineResource({
    name: "files",
    singular: "file",
    label: "File",
    labelPlural: "Files",
    description: "Receipts, scans and attachments stored in object storage (upload via POST /files/upload).",
    table: "files",
    area: "files",
    icon: "Paperclip",
    nav: { group: "overview", order: 90 },
    noCreate: true,
    fields: [
      f.string("name", "Name", { required: true, list: true, search: true, sortable: true, span: 4, format: "strong" }),
      f.string("mime_type", "Type", { readOnly: true, list: true }),
      f.int("size", "Size (bytes)", { readOnly: true, list: true, sortable: true }),
      f.string("ref_type", "Attached to", { list: true, filter: true, span: 1 }),
      f.int("ref_id", "Record", { filter: true, span: 1 }),
      f.text("description", "Description", { search: true, span: 6 }),
      f.string("storage_key", "Storage key", { readOnly: true, hidden: true }),
    ],
    titleSql: "name",
    defaultSort: { field: "created_at", dir: "desc" },
    hooks: {
      beforeDelete: async (ctx, r) => {
        const kept = await retentionReason(ctx, { id: Number(r.id), ref_type: (r.ref_type as string | null) ?? null, ref_id: (r.ref_id as number | null) ?? null });
        if (kept) throw new AppError("locked", kept);
        await deleteStoredObject(ctx, String(r.storage_key));
      },
    },
  }),
  defineResource(
    {
      name: "audit_log",
      singular: "audit_entry",
      label: "Audit entry",
      labelPlural: "Audit log",
      description: "Tamper-evident, hash-chained log of every change made through the UI, API or MCP.",
      table: "audit_log",
      area: "audit",
      icon: "ShieldCheck",
      nav: { group: "settings", order: 95 },
      readOnly: true,
      fields: [
        f.datetime("at", "Time", { list: true, sortable: true, filter: true }),
        f.string("actor_name", "Actor", { list: true, search: true, filter: true }),
        f.enum("actor_type", "Actor type", [opt("user", "User"), opt("api_key", "API key"), opt("system", "System")], { filter: true }),
        f.enum("source", "Source", [opt("ui", "Web app", "info"), opt("app", "Native app", "info"), opt("api", "REST API", "primary"), opt("mcp", "MCP", "warning"), opt("agent", "Batzi", "primary"), opt("email", "Email", "neutral"), opt("system", "System", "muted")], {
          list: true,
          filter: true,
        }),
        f.string("action", "Action", { list: true, filter: true, format: "code" }),
        f.string("resource", "Resource", { list: true, filter: true }),
        f.string("resource_id", "Record", { list: true, filter: true }),
        f.string("summary", "Summary", { list: true, search: true }),
        f.json("changes", "Changes"),
        f.string("ip", "IP address"),
        f.string("user_agent", "User agent"),
        f.json("context", "Provenance"),
        f.int("rollback_of", "Undoes entry", { filter: true }),
        f.string("hash", "Chain hash", { format: "code" }),
        f.int("hash_version", "Chain version", { hidden: true }),
      ],
      titleSql: "summary",
      defaultSort: { field: "at", dir: "desc" },
      actions: [
        {
          name: "undo",
          label: "Undo this change",
          description: "Puts the record back the way it was before this change (or removes what it created, or brings back what it deleted). Booked, issued or paid records are never rewritten.",
          icon: "Undo2",
          variant: "outline",
          confirm: "Undo this change?",
          // The undo checks write access on the changed record itself and records its own entry.
          level: "read",
          available: (r) => ["create", "update", "delete", "archive", "restore", "rollback"].includes(String(r.action)) && !!r.resource && !!r.resource_id,
          run: async (ctx, record) => {
            const done = await undoChange(ctx, Number(record.id));
            return { message: "Change undone.", redirect: { resource: done.resource, id: done.id } };
          },
        },
      ],
    },
    { stamps: false },
  ),
  defineResource(
    {
      name: "duplicates",
      singular: "duplicate",
      label: "Possible duplicate",
      labelPlural: "Possible duplicates",
      description: "Records that look like a copy of an earlier one: the same receipt or file twice, a supplier bill entered again, a customer created twice. Merge, remove the copy, or mark it as not a duplicate.",
      table: "duplicates",
      area: "audit",
      icon: "Copy",
      nav: { group: "settings", order: 96 },
      noCreate: true,
      noDelete: true,
      readOnly: true,
      fields: [
        f.enum("resource", "Kind", [opt("contacts", "Contact"), opt("bills", "Supplier bill"), opt("expenses", "Expense"), opt("files", "File")], { list: true, filter: true }),
        f.int("record_id", "Copy", { list: true }),
        f.int("original_id", "Original", { list: true }),
        f.enum(
          "reason",
          "Why",
          [
            opt("same_file", "Same file", "danger"),
            opt("same_reference", "Same payment reference", "danger"),
            opt("same_supplier_number", "Same supplier invoice number", "danger"),
            opt("same_amount_date", "Same amount and date", "warning"),
            opt("same_email", "Same email address", "warning"),
            opt("same_uid", "Same UID / VAT number", "danger"),
            opt("same_name", "Same name", "warning"),
          ],
          { list: true, filter: true },
        ),
        f.int("score", "Certainty %", { list: true, sortable: true }),
        f.enum("status", "Status", [opt("open", "Open", "warning"), opt("dismissed", "Not a duplicate", "muted"), opt("resolved", "Resolved", "success")], { list: true, filter: true, readOnly: true }),
      ],
      // The copy's own name, number or file name.
      titleSql: `CASE resource
        WHEN 'contacts' THEN (SELECT name_1 || COALESCE(' ' || name_2, '') FROM contacts WHERE id = duplicates.record_id)
        WHEN 'bills' THEN (SELECT COALESCE(nr, title) FROM bills WHERE id = duplicates.record_id)
        WHEN 'expenses' THEN (SELECT COALESCE(nr, title) FROM expenses WHERE id = duplicates.record_id)
        WHEN 'files' THEN (SELECT name FROM files WHERE id = duplicates.record_id) END`,
      statusField: "status",
      defaultSort: { field: "created_at", dir: "desc" },
      actions: [
        {
          name: "show_copy",
          label: "Show the copy",
          description: "Opens the record that looks like a copy.",
          icon: "Eye",
          variant: "outline",
          level: "read",
          run: async (_ctx, r) => ({ redirect: { resource: String(r.resource), id: Number(r.record_id) } }),
        },
        {
          name: "show_original",
          label: "Show the original",
          description: "Opens the earlier record it looks like.",
          icon: "Eye",
          variant: "outline",
          level: "read",
          run: async (_ctx, r) => ({ redirect: { resource: String(r.resource), id: Number(r.original_id) } }),
        },
        {
          name: "merge",
          label: "Merge into the original",
          description: "Moves every document, bill, project, person and file of the copy to the original contact, then archives the copy.",
          icon: "Merge",
          confirm: "Merge this contact into the original?",
          level: "read",
          available: (r) => r.status === "open" && r.resource === "contacts",
          run: async (ctx, r) => {
            await mergeContacts(ctx, Number(r.original_id), Number(r.record_id));
            return { message: "Contacts merged.", redirect: { resource: "contacts", id: Number(r.original_id) } };
          },
        },
        {
          name: "remove_copy",
          label: "Remove the copy",
          description: "Deletes the copy and keeps the original. Booked or paid copies have to be cancelled or reversed instead.",
          icon: "Trash2",
          variant: "destructive",
          confirm: "Remove the copy and keep the original?",
          level: "read",
          available: (r) => r.status === "open" && r.resource !== "contacts",
          run: async (ctx, r) => {
            const res = getResource(String(r.resource));
            if (!res) throw new AppError("not_found", "Unknown resource.");
            assertCan(ctx, res.area, "write");
            await deleteRecord(ctx, res, Number(r.record_id), { auditAction: "delete", auditContext: { duplicate_of: Number(r.original_id) } });
            await ctx.db.run("UPDATE duplicates SET status = 'resolved', updated_at = ?, updated_by = ? WHERE id = ?", new Date().toISOString(), ctx.actor.name, r.id);
            return { message: "Copy removed.", redirect: { resource: String(r.resource), id: Number(r.original_id) } };
          },
        },
        {
          name: "dismiss",
          label: "Not a duplicate",
          description: "Keeps both records and stops flagging this pair.",
          icon: "Check",
          variant: "outline",
          level: "read",
          available: (r) => r.status === "open",
          run: async (ctx, r) => {
            const res = getResource(String(r.resource));
            if (res) assertCan(ctx, res.area, "write");
            await ctx.db.run("UPDATE duplicates SET status = 'dismissed', updated_at = ?, updated_by = ? WHERE id = ?", new Date().toISOString(), ctx.actor.name, r.id);
            await audit(ctx, { action: "dismiss_duplicate", resource: String(r.resource), resourceId: Number(r.record_id), summary: `Not a duplicate of #${r.original_id}` });
            return { message: "Marked as not a duplicate." };
          },
        },
      ],
    },
  ),
];
