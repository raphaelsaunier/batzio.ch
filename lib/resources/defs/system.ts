import { deleteStoredObject } from "@/lib/server/files";
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
        f.enum("source", "Source", [opt("ui", "Web app", "info"), opt("api", "REST API", "primary"), opt("mcp", "MCP", "warning"), opt("system", "System", "muted")], {
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
        f.string("hash", "Chain hash", { format: "code" }),
      ],
      titleSql: "summary",
      defaultSort: { field: "at", dir: "desc" },
    },
    { stamps: false },
  ),
];
