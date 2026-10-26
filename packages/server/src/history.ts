import { formatAmount, formatDate, formatDateTime, formatDecimal } from "@batzio/core/format";
import type { TFunction as T } from "@batzio/i18n";
import type { AuditRow } from "./audit";
import { createRecord, deleteRecord, getRecord, parseJsonArray, recordTitle, refLabels, restoreRecord, toApi, updateRecord } from "./crud";
import { assertCan, isAutomated, type Ctx } from "./ctx";
import { AppError } from "./errors";
import { getResource } from "./resources/registry";
import type { ChildDef, FieldDef, ResourceDef, Row } from "./resources/types";

/**
 * The audit log in words: who changed what, from where, how it looked before and
 * after, and whether it can be undone. Shared by the web, the apps and the API.
 */

export interface HistoryChange {
  field: string;
  label: string;
  kind: "changed" | "added" | "removed";
  from: string | null;
  to: string | null;
}

export interface HistoryEntry {
  id: number;
  at: string;
  when: string;
  action: string;
  title: string;
  summary: string | null;
  resource: string | null;
  recordId: number | null;
  actor: { name: string | null; type: string; automated: boolean; source: string; sourceLabel: string };
  /** Where the change came from, e.g. [{ label: "Batzi", detail: "Create invoice" }]. */
  provenance: { label: string; detail: string | null }[];
  device: string | null;
  ip: string | null;
  changes: HistoryChange[];
  undo: { possible: boolean; reason: string | null; undoneBy: number | null; undoes: number | null };
  sealed: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  ui: "Web app",
  app: "Native app",
  api: "REST API",
  mcp: "MCP",
  agent: "Batzi",
  email: "Email",
  system: "Batzio",
};

const ACTION_LABELS: Record<string, string> = {
  create: "Created",
  update: "Changed",
  delete: "Deleted",
  archive: "Archived",
  restore: "Restored",
  rollback: "Undone",
  upload: "Uploaded",
  merge: "Merged",
};

/** Actions an undo knows how to reverse. Everything else has a proper counter-action (credit note, reversal, revert to draft). */
const REVERSIBLE = new Set(["create", "update", "delete", "archive", "restore", "rollback"]);

const HIDDEN = new Set(["id", "created_at", "updated_at", "created_by", "updated_by", "archived_at", "hash", "search_text"]);

const english: T = (key, vars) => key.replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? ""));

/** "Safari on macOS", "Batzio for iPhone", "Script (curl)" — or null when unknown. */
export function describeDevice(userAgent: string | null | undefined, t: T = english): string | null {
  if (!userAgent) return null;
  const ua = userAgent;
  const app = /^Batzio-(iOS|iPadOS|macOS|visionOS|Android|Windows)\b/i.exec(ua);
  if (app) {
    const names: Record<string, string> = { ios: "iPhone", ipados: "iPad", macos: "Mac", visionos: "Apple Vision Pro", android: "Android", windows: "Windows" };
    return t("Batzio for {platform}", { platform: names[app[1].toLowerCase()] });
  }
  const script = /^(curl|wget|python-requests|python-httpx|node|axios|Go-http-client|okhttp|PostmanRuntime|insomnia)\b/i.exec(ua);
  if (script) return t("Script ({tool})", { tool: script[1] });
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Version\/[\d.]+.*Safari\//.test(ua) ? "Safari" : null;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  if (browser && os) return t("{browser} on {os}", { browser, os });
  return browser ?? os ?? null;
}

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const isDiff = (v: unknown): v is { from: unknown; to: unknown } => !!v && typeof v === "object" && !Array.isArray(v) && "from" in v && "to" in v;

type Labels = Record<string, Record<string, string>>;

function formatValue(t: T, field: FieldDef | undefined, value: unknown, labels: Labels): string | null {
  if (value === null || value === undefined || value === "") return null;
  switch (field?.type) {
    case "money":
      return formatAmount(Number(value));
    case "decimal":
      return formatDecimal(Number(value), 4);
    case "percent":
      return `${formatDecimal(Number(value), 2)} %`;
    case "date":
      return formatDate(String(value));
    case "datetime":
      return formatDateTime(String(value));
    case "boolean":
      return value === true || value === 1 || value === "1" ? t("Yes") : t("No");
    case "enum": {
      const option = field.options?.find((o) => o.value === String(value));
      return option ? t(option.label) : String(value);
    }
    case "ref":
      return labels[field.name]?.[String(value)] ?? `#${value}`;
    case "tags":
      return parseJsonArray(value).map((id) => labels[field.name]?.[String(id)] ?? `#${id}`).join(", ") || null;
    case "json":
      return typeof value === "string" ? value.slice(0, 160) : JSON.stringify(value).slice(0, 160);
    default: {
      const text = typeof value === "object" ? JSON.stringify(value) : String(value);
      return text.length > 160 ? `${text.slice(0, 157)}…` : text;
    }
  }
}

function childTitle(child: ChildDef, row: Row, index: number, t: T, labels: Labels): string {
  const name = row.text ?? row.name ?? row.description ?? row.title;
  const amount = child.fields.find((f) => f.type === "money" && (f.name === "total" || f.name === "amount" || f.name === "unit_price"));
  const money = amount && row[amount.name] !== undefined && row[amount.name] !== null ? ` (${formatValue(t, amount, row[amount.name], labels)})` : "";
  return `${name ? String(name).split("\n")[0].slice(0, 80) : `${t(child.label)} ${index + 1}`}${money}`;
}

function describeChildren(t: T, child: ChildDef, before: Row[], after: Row[], labels: Labels): HistoryChange[] {
  const out: HistoryChange[] = [];
  const label = t(child.label);
  const old = new Map(before.filter((r) => r.id !== undefined).map((r) => [Number(r.id), r]));
  after.forEach((row, i) => {
    const prev = row.id !== undefined ? old.get(Number(row.id)) : undefined;
    if (!prev) {
      out.push({ field: child.name, label, kind: "added", from: null, to: childTitle(child, row, i, t, labels) });
      return;
    }
    old.delete(Number(row.id));
    const fields = child.fields.filter((f) => !HIDDEN.has(f.name) && JSON.stringify(prev[f.name] ?? null) !== JSON.stringify(row[f.name] ?? null));
    if (fields.length) {
      const detail = fields.map((f) => `${t(f.label)}: ${formatValue(t, f, prev[f.name], labels) ?? "–"} → ${formatValue(t, f, row[f.name], labels) ?? "–"}`).join(", ");
      out.push({ field: child.name, label, kind: "changed", from: childTitle(child, prev, i, t, labels), to: detail });
    }
  });
  for (const [, row] of old) out.push({ field: child.name, label, kind: "removed", from: childTitle(child, row, 0, t, labels), to: null });
  return out;
}

async function describeChanges(ctx: Ctx, t: T, res: ResourceDef | undefined, row: AuditRow): Promise<HistoryChange[]> {
  const parsed = parseJson(row.changes);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const changes = parsed as Row;
  const fields = new Map((res?.fields ?? []).map((f) => [f.name, f]));
  const children = new Map((res?.children ?? []).map((c) => [c.name, c]));

  // Resolve every referenced record in one go (both sides of each change).
  const refRows: Row[] = [{}, {}];
  for (const [key, value] of Object.entries(changes)) {
    if (isDiff(value)) {
      refRows[0][key] = value.from;
      refRows[1][key] = value.to;
    } else refRows[0][key] = value;
  }
  const labels = res ? await refLabels(ctx, res, refRows, getResource) : {};

  const out: HistoryChange[] = [];
  const removal = row.action === "delete";
  for (const [key, value] of Object.entries(changes)) {
    if (HIDDEN.has(key)) continue;
    const child = children.get(key);
    if (child) {
      if (isDiff(value)) {
        if (Array.isArray(value.from) && Array.isArray(value.to)) out.push(...describeChildren(t, child, value.from as Row[], value.to as Row[], labels));
        else out.push({ field: key, label: t(child.label), kind: "changed", from: String(value.from), to: String(value.to) });
      } else if (Array.isArray(value)) {
        value.forEach((r, i) => out.push({ field: key, label: t(child.label), kind: removal ? "removed" : "added", from: removal ? childTitle(child, r as Row, i, t, labels) : null, to: removal ? null : childTitle(child, r as Row, i, t, labels) }));
      }
      continue;
    }
    const field = fields.get(key);
    const label = field ? t(field.label) : key.replace(/_/g, " ");
    if (isDiff(value)) {
      out.push({ field: key, label, kind: "changed", from: formatValue(t, field, value.from, labels), to: formatValue(t, field, value.to, labels) });
    } else {
      const text = formatValue(t, field, value, labels);
      if (text === null) continue;
      out.push({ field: key, label, kind: removal ? "removed" : "added", from: removal ? text : null, to: removal ? null : text });
    }
  }
  return out;
}

function provenance(t: T, context: Row | null): HistoryEntry["provenance"] {
  if (!context) return [];
  const out: HistoryEntry["provenance"] = [];
  const humanize = (s: unknown) => String(s).replace(/_/g, " ");
  const viaMcp = !!(context.mcp || context.mcp_client);
  if (context.thread || (context.tool && !viaMcp)) out.push({ label: t("Conversation with Batzi"), detail: context.tool ? humanize(context.tool) : null });
  if (viaMcp) out.push({ label: "MCP", detail: [context.mcp_client, context.tool ? humanize(context.tool) : null].filter(Boolean).join(" · ") || null });
  if (context.request) out.push({ label: t("API request"), detail: String(context.request) });
  if (context.api_key) out.push({ label: t("API key"), detail: String(context.api_key) });
  if (context.sentence) out.push({ label: t("Quick sentence"), detail: `“${String(context.sentence).slice(0, 120)}”` });
  if (context.email_from) out.push({ label: t("Email"), detail: [context.email_from, context.email_subject].filter(Boolean).join(" · ") });
  if (context.import) out.push({ label: t("Moving in"), detail: String(context.import) });
  if (context.idempotency_key) out.push({ label: t("Retry-safe request"), detail: String(context.idempotency_key).slice(0, 36) });
  return out;
}

/** Why an entry cannot be undone, or null when it can. */
async function undoBlocker(ctx: Ctx, row: AuditRow, res: ResourceDef | undefined, undoneBy: number | null): Promise<string | null> {
  if (undoneBy) return "This change was already undone.";
  if (!REVERSIBLE.has(row.action)) return "This step has its own counter-action (for example a credit note, a reversal or “revert to draft”).";
  if (!res || res.readOnly || !row.resource_id) return "Only changes to records can be undone.";
  const id = Number(row.resource_id);
  const current = await getRecord(ctx, res, id, true).catch(() => null);
  if (row.action === "delete") {
    if (res.name === "files") return "The file itself was removed with it.";
    return current ? "The record exists again." : null;
  }
  if (!current) return "The record no longer exists.";
  const lock = res.hooks?.lockReason?.(current);
  if (lock && row.action !== "archive") return lock;
  if (row.action === "update" || row.action === "rollback") {
    const changes = (parseJson(row.changes) ?? {}) as Row;
    const diffs = Object.entries(changes).filter((e): e is [string, { from: unknown; to: unknown }] => isDiff(e[1]));
    if (!diffs.length) return "This step has its own counter-action (for example a credit note, a reversal or “revert to draft”).";
    // Only when the record still looks exactly like right after the change.
    const project = (rows: Row[], keys: string[]) => rows.map((r) => keys.map((k) => r[k] ?? null));
    for (const [key, value] of diffs) {
      const now = current[key] ?? null;
      const child = res.children?.some((c) => c.name === key);
      if (child && !Array.isArray(value.to)) return "This change was recorded before undo existed.";
      const same = child
        ? (() => {
            const keys = [...new Set((value.to as Row[]).flatMap((r) => Object.keys(r)))].filter((k) => k !== "id");
            return JSON.stringify(project(value.to as Row[], keys)) === JSON.stringify(project(Array.isArray(now) ? (now as Row[]) : [], keys));
          })()
        : JSON.stringify(now) === JSON.stringify(value.to ?? null);
      if (!same) return "This record was changed again since. Undo the later change first.";
    }
  }
  return null;
}

async function describe(ctx: Ctx, t: T, row: AuditRow, undoneBy: number | null, checkUndo: boolean): Promise<HistoryEntry> {
  const res = row.resource ? getResource(row.resource) : undefined;
  const context = parseJson(row.context) as Row | null;
  const actionDef = res?.actions?.find((a) => a.name === row.action);
  const reason = checkUndo ? await undoBlocker(ctx, row, res, undoneBy) : "";
  return {
    id: row.id,
    at: row.at,
    when: formatDateTime(row.at),
    action: row.action,
    title: t(ACTION_LABELS[row.action] ?? actionDef?.label ?? row.action.replace(/_/g, " ")),
    summary: row.summary,
    resource: row.resource,
    recordId: row.resource_id && /^\d+$/.test(row.resource_id) ? Number(row.resource_id) : null,
    actor: {
      name: row.actor_name,
      type: row.actor_type,
      automated: isAutomated(row.source) || !!context?.import,
      source: row.source,
      sourceLabel: t(SOURCE_LABELS[row.source] ?? row.source),
    },
    provenance: provenance(t, context),
    device: describeDevice(row.user_agent, t),
    ip: row.ip,
    changes: await describeChanges(ctx, t, res, row),
    undo: { possible: checkUndo && reason === null, reason: reason ? t(reason) : null, undoneBy, undoes: row.rollback_of ?? null },
    sealed: !!row.hash,
  };
}

/** The history of one record, newest first. */
export async function recordHistory(ctx: Ctx, t: T, resource: string, id: number, limit = 50): Promise<HistoryEntry[]> {
  assertCan(ctx, "audit", "read");
  const rows = await ctx.db.all<AuditRow>("SELECT * FROM audit_log WHERE resource = ? AND resource_id = ? ORDER BY id DESC LIMIT ?", resource, String(id), limit);
  return describeRows(ctx, t, rows);
}

/** One audit entry in words. */
export async function historyEntry(ctx: Ctx, t: T, id: number): Promise<HistoryEntry> {
  assertCan(ctx, "audit", "read");
  const row = await ctx.db.first<AuditRow>("SELECT * FROM audit_log WHERE id = ?", id);
  if (!row) throw new AppError("not_found", "{resource} not found.", undefined, { resource: "Audit entry" });
  return (await describeRows(ctx, t, [row]))[0];
}

async function describeRows(ctx: Ctx, t: T, rows: AuditRow[]): Promise<HistoryEntry[]> {
  if (!rows.length) return [];
  const undone = await ctx.db.all<{ id: number; rollback_of: number }>(
    `SELECT id, rollback_of FROM audit_log WHERE rollback_of IN (${rows.map(() => "?").join(",")})`,
    ...rows.map((r) => r.id),
  );
  const undoneBy = new Map(undone.map((u) => [u.rollback_of, u.id]));
  // Only the newest change of each record can be undone; checking it needs a read of the record.
  const newest = new Set<number>();
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.resource}:${r.resource_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      newest.add(r.id);
    }
  }
  return Promise.all(rows.map((r) => describe(ctx, t, r, undoneBy.get(r.id) ?? null, newest.has(r.id) && canUndo(ctx, r))));
}

function canUndo(ctx: Ctx, row: AuditRow): boolean {
  const res = row.resource ? getResource(row.resource) : undefined;
  return !!res && ctx.scope === "write" && ctx.role !== "viewer" && REVERSIBLE.has(row.action);
}

/**
 * Undoes one change: puts the previous values back, removes what was created,
 * brings back what was deleted. Refuses when the record is locked (booked,
 * issued, paid…) or was changed again since; the undo itself is audited and
 * linked to the entry it reverses.
 */
export async function undoChange(ctx: Ctx, auditId: number): Promise<{ resource: string; id: number; message: string }> {
  const row = await ctx.db.first<AuditRow>("SELECT * FROM audit_log WHERE id = ?", auditId);
  if (!row) throw new AppError("not_found", "{resource} not found.", undefined, { resource: "Audit entry" });
  const res = row.resource ? getResource(row.resource) : undefined;
  if (!res) throw new AppError("validation", "Only changes to records can be undone.");
  assertCan(ctx, res.area, "write");
  const undoneBy = (await ctx.db.first<{ id: number }>("SELECT id FROM audit_log WHERE rollback_of = ?", auditId))?.id ?? null;
  const blocker = await undoBlocker(ctx, row, res, undoneBy);
  if (blocker) throw new AppError("conflict", blocker);

  const id = Number(row.resource_id);
  const opts = { auditAction: "rollback", rollbackOf: auditId };
  const changes = (parseJson(row.changes) ?? {}) as Row;
  const title = recordTitle(res, (await getRecord(ctx, res, id, false).catch(() => null)) ?? (changes as Row));
  switch (row.action) {
    case "update":
    case "rollback": {
      // Back to the previous values, through the normal validation and hooks (totals, bookings).
      const previous: Row = {};
      for (const [key, value] of Object.entries(changes)) if (isDiff(value)) previous[key] = value.from;
      await updateRecord(ctx, res, id, toApi(res, previous), { ...opts, auditSummary: `Undid a change to ${res.label.toLowerCase()} ${title}` });
      break;
    }
    case "create":
      await deleteRecord(ctx, res, id, { ...opts });
      break;
    case "delete": {
      const snapshot: Row = { ...changes };
      for (const key of HIDDEN) delete snapshot[key];
      await createRecord(ctx, res, toApi(res, snapshot), { ...opts, keepId: id, auditSummary: `Brought back ${res.label.toLowerCase()} ${title}` });
      break;
    }
    case "archive":
      await restoreRecord(ctx, res, id, opts);
      break;
    case "restore":
      await deleteRecord(ctx, res, id, { ...opts });
      break;
    default:
      throw new AppError("conflict", "This step has its own counter-action (for example a credit note, a reversal or “revert to draft”).");
  }
  // Link the undo to the entry it reverses (the write above recorded it as its newest entry).
  return { resource: res.name, id, message: `Undone: ${row.summary ?? row.action}` };
}
