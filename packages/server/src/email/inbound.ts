import PostalMime from "postal-mime";
import { processInboxItem, createInboxItem, dropFiles } from "../agent/inbox";
import { localeFromLanguage } from "@batzio/i18n";
import type { Role } from "@batzio/core/permissions";
import { randomToken } from "../auth/crypto";
import { findUserByEmail, getMembership, type TenantRow } from "../control";
import type { Ctx } from "../ctx";
import { openControlDb, openTenantDb } from "../db/connections";
import type { Db } from "../db/db";
import type { R2LikeBucket } from "../db/types";
import type { AppEnv } from "../env";
import { getSettings } from "../settings";

/**
 * Inbound email. Every company gets a private address
 * `<slug>.<token>@<EMAIL_DOMAIN>`; Cloudflare Email Routing hands mail for the
 * domain to the Worker's email() handler. Attachments from anyone (suppliers
 * can send bills straight in) become inbox items; instructions in the body
 * are only followed when the sender is an authenticated team member.
 */
export const MAX_EMAIL_BYTES = 25 * 1024 * 1024;

export function inboxAddress(tenant: Pick<TenantRow, "slug"> & { inbox_token?: string | null }, domain: string | undefined): string | null {
  return tenant.inbox_token && domain ? `${tenant.slug}.${tenant.inbox_token}@${domain}` : null;
}

/** The company's address, creating its secret token on first use. */
export async function ensureInboxToken(control: Db, tenantId: string): Promise<string> {
  const existing = await control.value<string>("SELECT inbox_token FROM tenants WHERE id = ?", tenantId);
  if (existing) return existing;
  const token = randomToken(8).replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 10);
  await control.run("UPDATE tenants SET inbox_token = ? WHERE id = ? AND inbox_token IS NULL", token, tenantId);
  return (await control.value<string>("SELECT inbox_token FROM tenants WHERE id = ?", tenantId))!;
}

export async function rotateInboxToken(control: Db, tenantId: string): Promise<string> {
  await control.run("UPDATE tenants SET inbox_token = NULL WHERE id = ?", tenantId);
  return ensureInboxToken(control, tenantId);
}

/** `acme.k3x9q2m7pa@in.batzio.ch` → tenant (token must match). */
export async function tenantForAddress(control: Db, to: string): Promise<TenantRow | null> {
  const local = to.trim().toLowerCase().split("@")[0] ?? "";
  const dot = local.lastIndexOf(".");
  if (dot <= 0) return null;
  const slug = local.slice(0, dot);
  const token = local.slice(dot + 1).replace(/\+.*$/, "");
  return control.first<TenantRow>("SELECT * FROM tenants WHERE slug = ? AND inbox_token = ? AND status = 'active'", slug, token);
}

/** DMARC/DKIM/SPF as stamped by the receiving MTA. */
export function senderAuthenticated(authResults: string | null | undefined): boolean {
  if (!authResults) return false;
  return /\bdmarc=pass\b/i.test(authResults) || (/\bdkim=pass\b/i.test(authResults) && /\bspf=pass\b/i.test(authResults));
}

const bytesOf = (content: ArrayBuffer | Uint8Array | string): ArrayBuffer => {
  if (typeof content === "string") return new TextEncoder().encode(content).buffer as ArrayBuffer;
  if (content instanceof Uint8Array) return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
  return content;
};

/** Tools Batzi may use for mail from people outside the team: read and record, nothing else. */
export const UNTRUSTED_EMAIL_TOOLS = ["list_resource_types", "search_records", "get_record", "create_bill", "create_expense", "attach_file", "import_bank_file"];

export interface IngestResult {
  ok: boolean;
  reason?: string;
  inboxId?: number;
  trusted?: boolean;
}

/**
 * Stores an email and its attachments as one inbox item and (when an agent is
 * configured) lets Batzi process it. Used by the email() handler and the
 * raw-MIME API endpoint.
 */
export interface IngestInput {
  raw: ArrayBuffer | string;
  tenant: TenantRow;
  envelopeFrom?: string | null;
  authenticated: boolean;
  process?: (work: Promise<unknown>) => void;
  trustedOverride?: boolean;
}

export async function ingestEmail(env: AppEnv, input: IngestInput): Promise<IngestResult> {
  return ingestEmailInto(
    { control: await openControlDb(env), db: await openTenantDb(env, input.tenant), files: env.FILES as R2LikeBucket | undefined, apiKey: env.ANTHROPIC_API_KEY ?? null },
    input,
  );
}

export async function ingestEmailInto(
  deps: { control: Db; db: Db; files?: R2LikeBucket; apiKey: string | null },
  input: IngestInput,
): Promise<IngestResult> {
  const { control, db } = deps;
  const email = await PostalMime.parse(input.raw);
  const fromAddress = (email.from && "address" in email.from ? email.from.address : null) ?? input.envelopeFrom ?? null;
  const fromName = email.from && "name" in email.from ? email.from.name : null;

  // Is the sender a member of this company?
  const user = fromAddress ? await findUserByEmail(control, fromAddress) : null;
  const membership = user ? await getMembership(control, user.id, input.tenant.slug) : null;
  const trusted = input.trustedOverride ?? (!!membership && input.authenticated);

  const ctx: Ctx = {
    tenant: { id: input.tenant.id, slug: input.tenant.slug, name: input.tenant.name, locale: input.tenant.locale },
    user: trusted && user ? { id: user.id, name: user.name, email: user.email } : null,
    role: trusted && membership ? membership.role : ("member" as Role),
    scope: "write",
    actor: {
      type: trusted && user ? "user" : "system",
      id: trusted && user ? user.id : null,
      name: `${fromName || fromAddress || "Unknown"} (email)`,
      source: "email",
      context: { email_from: fromAddress, email_subject: email.subject?.slice(0, 120) ?? null, trusted_sender: trusted },
    },
    db,
    control,
    files: deps.files,
  };

  const attachments = email.attachments.filter((a) => !a.related && a.filename && !/^(text\/calendar|application\/pgp)/.test(a.mimeType));
  // Store attachments; spreadsheets and bank files are handled on the spot.
  const drops = attachments.length
    ? await dropFiles(
        ctx,
        attachments.slice(0, 10).map((a) => ({ name: a.filename!, type: a.mimeType, bytes: bytesOf(a.content) })),
        "email",
      )
    : [];
  const open = drops.filter((d) => !d.handled);
  const body = (email.text ?? email.html?.replace(/<[^>]+>/g, " ") ?? "").replace(/\n{3,}/g, "\n\n").trim();

  if (!trusted && !open.length) {
    // Nothing to record and no one to take orders from: keep it for a human glance.
    // (Attachments seen before — a reminder with the same invoice — are recognised and not booked twice.)
    const inboxId = await createInboxItem(ctx, { source: "email", kind: drops.length ? "attachments" : "message", status: drops.length ? "done" : "new", title: email.subject || "(no subject)", sender: fromAddress, subject: email.subject, body, fileId: drops[0]?.file.id ?? null, payload: { trusted, files: drops.map((d) => d.file.id), handled: drops.filter((d) => d.handled).map((d) => d.message) } });
    return { ok: true, inboxId, trusted };
  }

  // Drop items created per attachment are folded into one email item.
  for (const d of drops) await db.run("DELETE FROM inbox_items WHERE id = ?", d.inboxId);
  const inboxId = await createInboxItem(ctx, {
    source: "email",
    kind: "email",
    status: "new",
    title: email.subject || "(no subject)",
    sender: fromAddress,
    subject: email.subject,
    body,
    fileId: open[0]?.file.id ?? null,
    payload: { trusted, message_id: email.messageId, files: drops.map((d) => d.file.id), handled: drops.filter((d) => d.handled).map((d) => d.message) },
  });

  const company = await getSettings(ctx, "company").catch(() => null);
  const work = processInboxItem(
    ctx,
    inboxId,
    { apiKey: deps.apiKey, locale: localeFromLanguage(company?.language ?? input.tenant.locale), allowedTools: trusted ? undefined : UNTRUSTED_EMAIL_TOOLS },
    open.slice(1).map((d) => d.file.id),
  );
  if (input.process) input.process(work);
  else await work;
  return { ok: true, inboxId, trusted };
}

/** Minimal shape of Cloudflare's ForwardableEmailMessage. */
export interface InboundMessage {
  from: string;
  to: string;
  raw: ReadableStream<Uint8Array>;
  rawSize: number;
  headers: Headers;
  setReject(reason: string): void;
}

export async function handleEmailEvent(message: InboundMessage, env: AppEnv, waitUntil: (p: Promise<unknown>) => void): Promise<void> {
  if (message.rawSize > MAX_EMAIL_BYTES) return message.setReject("Message too large for Batzio (max 25 MB).");
  const control = await openControlDb(env);
  const tenant = await tenantForAddress(control, message.to);
  if (!tenant) return message.setReject("Unknown Batzio address.");
  const raw = await new Response(message.raw).arrayBuffer();
  await ingestEmail(env, {
    raw,
    tenant,
    envelopeFrom: message.from,
    authenticated: senderAuthenticated(message.headers.get("authentication-results")),
    process: waitUntil,
  });
}
