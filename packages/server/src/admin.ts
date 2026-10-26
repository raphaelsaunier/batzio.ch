import { isRole, type Role } from "@batzio/core/permissions";
import { N_, type TFunction } from "@batzio/i18n";
import { audit } from "./audit";
import { createApiKey, inviteMember, removeMember, renameTenant, revokeApiKey, setMemberRole } from "./control";
import { assertCan, type Ctx } from "./ctx";
import { inboxAddress, rotateInboxToken } from "./email/inbound";
import { getEnv } from "./env";
import { AppError } from "./errors";
import { renderNumber } from "./numbering";
import { translateField } from "./resources/client";
import { f, LANGUAGE_OPTIONS, opt } from "./resources/fields";
import type { FieldDef, Row } from "./resources/types";
import { getSettings, LOCALIZED_TEXTS, saveSettings, type DocumentTexts } from "./settings";

/**
 * Company administration shared by the web settings screens and the native
 * apps: settings forms, number formats, team members, API keys, inbox address.
 */

export const SETTINGS_GROUPS = ["company", "accounting", "texts"] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

export const COMPANY_FIELDS: FieldDef[] = [
  f.string("name", "Company name", { span: 4 }),
  f.string("legal_form", "Legal form", { span: 2, placeholder: "AG, GmbH, Sàrl…" }),
  f.string("street", "Street", { span: 4 }),
  f.string("house_number", "No.", { span: 2 }),
  f.string("postcode", "Postcode", { span: 2 }),
  f.string("city", "City", { span: 2 }),
  f.string("country_code", "Country", { span: 2, maxLength: 2 }),
  f.phone("phone", "Phone", { span: 2 }),
  f.email("email", "Email", { span: 2 }),
  f.string("website", "Website", { span: 2 }),
  f.string("vat_number", "UID / VAT number", { span: 3, placeholder: "CHE-123.456.789 MWST" }),
  f.string("commercial_register", "Commercial register no.", { span: 3 }),
  f.enum("language", "Default document language", LANGUAGE_OPTIONS, { span: 3 }),
  f.color("accent_color", "Accent colour", { span: 3 }),
];

export const TEXT_LABELS: Record<keyof DocumentTexts, string> = {
  quote_header: N_("Quote: intro"),
  quote_footer: N_("Quote: closing"),
  order_header: N_("Order confirmation: intro"),
  invoice_header: N_("Invoice: intro"),
  invoice_footer: N_("Invoice: closing"),
  credit_note_header: N_("Credit note: intro"),
  delivery_header: N_("Delivery note: intro"),
  reminder_header: N_("Reminder: intro"),
};

export const ACCOUNTING_FIELDS: FieldDef[] = [
  f.boolean("vat_registered", "Registered for VAT", { span: 2 }),
  f.enum("vat_method", "VAT method", [opt("effective", "Effective method"), opt("net_tax_rate", "Net tax rate method")], { span: 2 }),
  f.enum("vat_period", "VAT period", [opt("quarterly", "Quarterly"), opt("semiannual", "Semi-annual"), opt("monthly", "Monthly")], { span: 2 }),
  f.enum("chf_rounding", "Rounding", [opt("0.05", "5 Rappen (0.05)"), opt("0.01", "1 Rappen (0.01)")], { span: 2 }),
  f.int("default_payment_days", "Payment terms", { span: 2, description: "Days" }),
  f.int("quote_validity_days", "Quote validity (days)", { span: 2 }),
  f.int("reminder_days", "Reminder payment period (days)", { span: 2 }),
];

/** The three settings forms, translated, with the current values. */
export async function settingsForms(ctx: Ctx, t: TFunction) {
  const [company, accounting, texts] = await Promise.all([getSettings(ctx, "company"), getSettings(ctx, "accounting"), getSettings(ctx, "texts")]);
  const lang = company.language;
  const textFields = (Object.keys(texts) as (keyof DocumentTexts)[])
    .map((k) => translateField(f.text(k, TEXT_LABELS[k] ?? k, { span: 3 }), t))
    .map((x) => ({ ...x, description: t("Default: “{text}…” (in each document’s language)", { text: LOCALIZED_TEXTS[lang][x.name as keyof DocumentTexts].slice(0, 70) }) }));
  return {
    company: { fields: COMPANY_FIELDS.map((x) => translateField(x, t)), values: company as unknown as Row },
    accounting: { fields: ACCOUNTING_FIELDS.map((x) => translateField(x, t)), values: { ...accounting, chf_rounding: String(accounting.chf_rounding) } as unknown as Row },
    texts: { fields: textFields, values: texts as unknown as Row },
  };
}

export async function saveSettingsGroup(ctx: Ctx, group: SettingsGroup, values: Row): Promise<void> {
  if (!SETTINGS_GROUPS.includes(group)) throw new AppError("validation", "Unknown settings group.");
  assertCan(ctx, "settings", "write");
  const clean: Row = {};
  for (const [k, v] of Object.entries(values)) clean[k] = typeof v === "string" ? v.trim() : v;
  if (group === "accounting") {
    for (const k of ["chf_rounding", "default_payment_days", "quote_validity_days", "reminder_days"]) if (k in clean) clean[k] = Number(clean[k]);
    if (Array.isArray(clean.reminder_fees)) clean.reminder_fees = (clean.reminder_fees as unknown[]).map(Number);
    if ("vat_registered" in clean) clean.vat_registered = clean.vat_registered === true || clean.vat_registered === "true";
  }
  await saveSettings(ctx, group, clean as never);
  if (group === "company" && typeof clean.name === "string" && clean.name) await renameTenant(ctx.control, ctx.tenant.id, clean.name);
  await audit(ctx, { action: "update_settings", resource: "settings", resourceId: group, summary: `Updated ${group} settings`, changes: clean });
}

/** Sets a document number format; returns the next number it will produce. */
export async function saveSequence(ctx: Ctx, key: string, format: string, nextValue: number): Promise<string> {
  assertCan(ctx, "settings", "write");
  if (!/\{#+\}/.test(format)) throw new AppError("validation", "The format needs a counter such as {####}.");
  if (!Number.isInteger(nextValue) || nextValue < 1) throw new AppError("validation", "The next number must be a positive integer.");
  await ctx.db.run(
    `INSERT INTO sequences (key, format, next_value, reset, last_year) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET format = excluded.format, next_value = excluded.next_value, reset = excluded.reset`,
    key,
    format,
    nextValue,
    /\{YY(YY)?\}/.test(format) ? "yearly" : "never",
    new Date().getUTCFullYear(),
  );
  await audit(ctx, { action: "update_sequence", resource: "sequences", resourceId: key, summary: `Number format for ${key}: ${format}` });
  return renderNumber(format, nextValue);
}

export async function inviteToCompany(ctx: Ctx, email: string, role: string): Promise<{ added: boolean; token?: string }> {
  assertCan(ctx, "users", "write");
  if (!isRole(role)) throw new AppError("validation", "Unknown role.");
  if (role === "owner" && ctx.role !== "owner") throw new AppError("forbidden", "Only owners can invite owners.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError("validation", "Enter a valid email.", { email: "Invalid" });
  const r = await inviteMember(ctx.control, { tenantId: ctx.tenant.id, email, role, invitedBy: ctx.user!.id });
  await audit(ctx, { action: "invite_member", resource: "users", summary: `Invited ${email} as ${role}` });
  return r.added ? { added: true } : { added: false, token: r.token };
}

export async function changeMemberRole(ctx: Ctx, userId: string, role: string): Promise<void> {
  assertCan(ctx, "users", "write");
  if (!isRole(role)) throw new AppError("validation", "Unknown role.");
  if ((role === "owner" || userId === ctx.user?.id) && ctx.role !== "owner") throw new AppError("forbidden", "Only owners can change this role.");
  await setMemberRole(ctx.control, ctx.tenant.id, userId, role as Role);
  await audit(ctx, { action: "change_role", resource: "users", resourceId: userId, summary: `Role changed to ${role}` });
}

export async function removeCompanyMember(ctx: Ctx, userId: string): Promise<void> {
  assertCan(ctx, "users", "write");
  await removeMember(ctx.control, ctx.tenant.id, userId);
  await audit(ctx, { action: "remove_member", resource: "users", resourceId: userId, summary: "Member removed" });
}

export async function issueApiKey(ctx: Ctx, name: string, scope: "read" | "write", role: string) {
  assertCan(ctx, "settings", "read");
  if (!isRole(role)) throw new AppError("validation", "Unknown role.");
  const issued = await createApiKey(ctx.control, {
    tenantId: ctx.tenant.id,
    userId: ctx.user!.id,
    userRole: ctx.role,
    name: name || "API key",
    scope,
    role: role as Role,
  });
  await audit(ctx, { action: "create_api_key", resource: "api_keys", resourceId: issued.record.id, summary: `API key “${issued.record.name}” (${scope}, ${issued.record.role}) created` });
  return issued;
}

export async function revokeCompanyApiKey(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx, "settings", "read");
  const owner = await ctx.control.value<string>("SELECT user_id FROM api_keys WHERE id = ? AND tenant_id = ?", id, ctx.tenant.id);
  if (!owner) throw new AppError("not_found", "API key not found.");
  if (owner !== ctx.user?.id && ctx.role !== "owner" && ctx.role !== "admin") throw new AppError("forbidden", "You can only revoke your own keys.");
  await revokeApiKey(ctx.control, ctx.tenant.id, id);
  await audit(ctx, { action: "revoke_api_key", resource: "api_keys", resourceId: id, summary: "API key revoked" });
}

/** Issues a new secret inbox address; the old one stops working immediately. */
export async function renewInboxAddress(ctx: Ctx): Promise<string | null> {
  assertCan(ctx, "settings", "write");
  const token = await rotateInboxToken(ctx.control, ctx.tenant.id);
  await audit(ctx, { action: "update", resource: "settings", summary: "Inbox address renewed" });
  return inboxAddress({ slug: ctx.tenant.slug, inbox_token: token }, getEnv().EMAIL_DOMAIN);
}
