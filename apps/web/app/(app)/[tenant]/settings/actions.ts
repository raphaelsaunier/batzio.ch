"use server";

import { revalidatePath } from "next/cache";
import type { Row } from "@batzio/server/resources/types";
import {
  changeMemberRole,
  inviteToCompany,
  issueApiKey,
  removeCompanyMember,
  renewInboxAddress,
  revokeCompanyApiKey,
  saveSequence,
  saveSettingsGroup,
  setCompanyLogo,
  type SettingsGroup,
} from "@batzio/server/admin";
import { errorText, toAppError } from "@batzio/server/errors";
import { importStep, type ImportProgress } from "@batzio/server/importer";
import { getT } from "@/lib/i18n/server";
import { tenantCtx } from "@/lib/server/session";
import type { ActionResponse } from "../actions";

const fail = async (error: unknown): Promise<ActionResponse> => {
  const e = toAppError(error);
  return { ok: false, error: errorText(e, await getT()), fields: e.fields };
};

export async function saveSettingsAction(tenant: string, group: SettingsGroup, values: Row): Promise<ActionResponse> {
  try {
    await saveSettingsGroup(await tenantCtx(tenant), group, values);
    revalidatePath(`/${tenant}`, "layout");
    return { ok: true, message: (await getT())("Settings saved.") };
  } catch (e) {
    return fail(e);
  }
}

/** Uses an uploaded image as the logo on every document, or removes it (`null`). */
export async function setLogoAction(tenant: string, fileId: number | null): Promise<ActionResponse> {
  try {
    await setCompanyLogo(await tenantCtx(tenant), fileId);
    revalidatePath(`/${tenant}`, "layout");
    const t = await getT();
    return { ok: true, message: fileId ? t("Logo saved.") : t("Logo removed.") };
  } catch (e) {
    return fail(e);
  }
}

export async function saveSequenceAction(tenant: string, key: string, format: string, nextValue: number): Promise<ActionResponse> {
  try {
    const nr = await saveSequence(await tenantCtx(tenant), key, format, nextValue);
    revalidatePath(`/${tenant}/settings`);
    return { ok: true, message: (await getT())("Next number: {nr}", { nr }) };
  } catch (e) {
    return fail(e);
  }
}

export async function inviteMemberAction(tenant: string, email: string, role: string): Promise<ActionResponse & { link?: string }> {
  try {
    const r = await inviteToCompany(await tenantCtx(tenant), email, role);
    revalidatePath(`/${tenant}/settings/users`);
    if (r.added) return { ok: true, message: (await getT())("{email} was added to the company.", { email }) };
    return { ok: true, message: (await getT())("Invitation created. Share the link with your colleague."), link: `/signup?invite=${r.token}` };
  } catch (e) {
    return fail(e);
  }
}

export async function setRoleAction(tenant: string, userId: string, role: string): Promise<ActionResponse> {
  try {
    await changeMemberRole(await tenantCtx(tenant), userId, role);
    revalidatePath(`/${tenant}/settings/users`);
    return { ok: true, message: (await getT())("Role updated.") };
  } catch (e) {
    return fail(e);
  }
}

export async function removeMemberAction(tenant: string, userId: string): Promise<ActionResponse> {
  try {
    await removeCompanyMember(await tenantCtx(tenant), userId);
    revalidatePath(`/${tenant}/settings/users`);
    return { ok: true, message: (await getT())("Member removed.") };
  } catch (e) {
    return fail(e);
  }
}

export async function createApiKeyAction(tenant: string, name: string, scope: "read" | "write", role: string): Promise<ActionResponse & { key?: string }> {
  try {
    const { key } = await issueApiKey(await tenantCtx(tenant), name, scope, role);
    revalidatePath(`/${tenant}/settings/api`);
    return { ok: true, message: (await getT())("API key created. Copy it now — it will not be shown again."), key };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeApiKeyAction(tenant: string, id: string): Promise<ActionResponse> {
  try {
    await revokeCompanyApiKey(await tenantCtx(tenant), id);
    revalidatePath(`/${tenant}/settings/api`);
    return { ok: true, message: (await getT())("API key revoked.") };
  } catch (e) {
    return fail(e);
  }
}

/** Issues a new secret inbox address; the old one stops working immediately. */
export async function rotateInboxAction(tenant: string): Promise<ActionResponse & { address?: string | null }> {
  try {
    const address = await renewInboxAddress(await tenantCtx(tenant));
    revalidatePath(`/${tenant}/settings`);
    return { ok: true, message: (await getT())("New address ready. The old one no longer works."), address };
  } catch (e) {
    return fail(e);
  }
}

/** One step of moving in from other software; the client repeats it until the import is done. */
export async function importStepAction(
  tenant: string,
  input: { token: string; baseUrl: string; restart?: boolean },
): Promise<{ ok: true; progress: ImportProgress } | { ok: false; error: string }> {
  try {
    const progress = await importStep(await tenantCtx(tenant), { baseUrl: input.baseUrl.trim(), token: input.token.trim() }, { restart: input.restart });
    if (progress.phase === "done") revalidatePath(`/${tenant}`, "layout");
    return { ok: true, progress };
  } catch (e) {
    return { ok: false, error: errorText(toAppError(e), await getT()) };
  }
}
