"use server";

import { revalidatePath } from "next/cache";
import { isRole, type Role } from "@/lib/permissions";
import type { Row } from "@/lib/resources/types";
import { audit } from "@/lib/server/audit";
import { createApiKey, inviteMember, removeMember, renameTenant, revokeApiKey, setMemberRole } from "@/lib/server/control";
import { assertCan } from "@/lib/server/ctx";
import { AppError, errorText, toAppError } from "@/lib/server/errors";
import { getT } from "@/lib/i18n/server";
import { renderNumber } from "@/lib/server/numbering";
import { saveSettings } from "@/lib/server/settings";
import { tenantCtx } from "@/lib/server/session";
import type { ActionResponse } from "../actions";
import { inboxAddress, rotateInboxToken } from "@/lib/server/email/inbound";
import { getEnv } from "@/lib/server/env";

const fail = async (error: unknown): Promise<ActionResponse> => {
  const e = toAppError(error);
  return { ok: false, error: errorText(e, await getT()), fields: e.fields };
};

const GROUPS = ["company", "accounting", "texts"] as const;

export async function saveSettingsAction(tenant: string, group: (typeof GROUPS)[number], values: Row): Promise<ActionResponse> {
  try {
    if (!GROUPS.includes(group)) throw new AppError("validation", "Unknown settings group.");
    const ctx = await tenantCtx(tenant);
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
    revalidatePath(`/${tenant}`, "layout");
    return { ok: true, message: (await getT())("Settings saved.") };
  } catch (e) {
    return fail(e);
  }
}

export async function saveSequenceAction(tenant: string, key: string, format: string, nextValue: number): Promise<ActionResponse> {
  try {
    const ctx = await tenantCtx(tenant);
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
    revalidatePath(`/${tenant}/settings`);
    return { ok: true, message: (await getT())("Next number: {nr}", { nr: renderNumber(format, nextValue) }) };
  } catch (e) {
    return fail(e);
  }
}

export async function inviteMemberAction(tenant: string, email: string, role: string): Promise<ActionResponse & { link?: string }> {
  try {
    const ctx = await tenantCtx(tenant);
    assertCan(ctx, "users", "write");
    if (!isRole(role)) throw new AppError("validation", "Unknown role.");
    if (role === "owner" && ctx.role !== "owner") throw new AppError("forbidden", "Only owners can invite owners.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new AppError("validation", "Enter a valid email.", { email: "Invalid" });
    const r = await inviteMember(ctx.control, { tenantId: ctx.tenant.id, email, role, invitedBy: ctx.user!.id });
    await audit(ctx, { action: "invite_member", resource: "users", summary: `Invited ${email} as ${role}` });
    revalidatePath(`/${tenant}/settings/users`);
    if (r.added) return { ok: true, message: (await getT())("{email} was added to the company.", { email }) };
    return { ok: true, message: (await getT())("Invitation created. Share the link with your colleague."), link: `/signup?invite=${r.token}` };
  } catch (e) {
    return fail(e);
  }
}

export async function setRoleAction(tenant: string, userId: string, role: string): Promise<ActionResponse> {
  try {
    const ctx = await tenantCtx(tenant);
    assertCan(ctx, "users", "write");
    if (!isRole(role)) throw new AppError("validation", "Unknown role.");
    if ((role === "owner" || userId === ctx.user?.id) && ctx.role !== "owner") throw new AppError("forbidden", "Only owners can change this role.");
    await setMemberRole(ctx.control, ctx.tenant.id, userId, role as Role);
    await audit(ctx, { action: "change_role", resource: "users", resourceId: userId, summary: `Role changed to ${role}` });
    revalidatePath(`/${tenant}/settings/users`);
    return { ok: true, message: (await getT())("Role updated.") };
  } catch (e) {
    return fail(e);
  }
}

export async function removeMemberAction(tenant: string, userId: string): Promise<ActionResponse> {
  try {
    const ctx = await tenantCtx(tenant);
    assertCan(ctx, "users", "write");
    await removeMember(ctx.control, ctx.tenant.id, userId);
    await audit(ctx, { action: "remove_member", resource: "users", resourceId: userId, summary: "Member removed" });
    revalidatePath(`/${tenant}/settings/users`);
    return { ok: true, message: (await getT())("Member removed.") };
  } catch (e) {
    return fail(e);
  }
}

export async function createApiKeyAction(tenant: string, name: string, scope: "read" | "write", role: string): Promise<ActionResponse & { key?: string }> {
  try {
    const ctx = await tenantCtx(tenant);
    assertCan(ctx, "settings", "read");
    if (!isRole(role)) throw new AppError("validation", "Unknown role.");
    const { key, record } = await createApiKey(ctx.control, {
      tenantId: ctx.tenant.id,
      userId: ctx.user!.id,
      userRole: ctx.role,
      name: name || "API key",
      scope,
      role: role as Role,
    });
    await audit(ctx, { action: "create_api_key", resource: "api_keys", resourceId: record.id, summary: `API key “${record.name}” (${scope}, ${record.role}) created` });
    revalidatePath(`/${tenant}/settings/api`);
    return { ok: true, message: (await getT())("API key created. Copy it now — it will not be shown again."), key };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeApiKeyAction(tenant: string, id: string): Promise<ActionResponse> {
  try {
    const ctx = await tenantCtx(tenant);
    assertCan(ctx, "settings", "read");
    const owner = await ctx.control.value<string>("SELECT user_id FROM api_keys WHERE id = ? AND tenant_id = ?", id, ctx.tenant.id);
    if (!owner) throw new AppError("not_found", "API key not found.");
    if (owner !== ctx.user?.id && ctx.role !== "owner" && ctx.role !== "admin") throw new AppError("forbidden", "You can only revoke your own keys.");
    await revokeApiKey(ctx.control, ctx.tenant.id, id);
    await audit(ctx, { action: "revoke_api_key", resource: "api_keys", resourceId: id, summary: "API key revoked" });
    revalidatePath(`/${tenant}/settings/api`);
    return { ok: true, message: (await getT())("API key revoked.") };
  } catch (e) {
    return fail(e);
  }
}

/** Issues a new secret inbox address; the old one stops working immediately. */
export async function rotateInboxAction(tenant: string): Promise<ActionResponse & { address?: string | null }> {
  try {
    const ctx = await tenantCtx(tenant);
    assertCan(ctx, "settings", "write");
    const token = await rotateInboxToken(ctx.control, ctx.tenant.id);
    await audit(ctx, { action: "update", resource: "settings", summary: "Inbox address renewed" });
    revalidatePath(`/${tenant}/settings`);
    return { ok: true, message: (await getT())("New address ready. The old one no longer works."), address: inboxAddress({ slug: tenant, inbox_token: token }, getEnv().EMAIL_DOMAIN) };
  } catch (e) {
    return fail(e);
  }
}
