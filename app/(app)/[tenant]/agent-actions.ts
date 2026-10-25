"use server";

import { revalidatePath } from "next/cache";
import { listInbox, updateInboxItem, type InboxItem } from "@/lib/agent/inbox";
import { planQuick, runQuick, type QuickOutcome, type QuickPlan } from "@/lib/agent/quick";
import { listThreads, loadThread, threadBelongsTo, toUiTurns, type UiTurn } from "@/lib/agent/threads";
import { getT } from "@/lib/i18n/server";
import { errorText, toAppError } from "@/lib/server/errors";
import { tenantCtx } from "@/lib/server/session";

/** Live preview of a quick sentence (“invoice Muster AG 3h consulting at 180”). */
export async function planQuickAction(tenant: string, text: string): Promise<QuickPlan | null> {
  if (text.trim().length < 3) return null;
  const ctx = await tenantCtx(tenant, "ui");
  return planQuick(ctx, text).catch(() => null);
}

export async function runQuickAction(tenant: string, text: string, actionId: string): Promise<{ ok: true; outcome: QuickOutcome } | { ok: false; error: string }> {
  try {
    const ctx = await tenantCtx(tenant, "ui");
    const outcome = await runQuick(ctx, text, actionId);
    revalidatePath(`/${tenant}`, "layout");
    return { ok: true, outcome };
  } catch (error) {
    return { ok: false, error: errorText(toAppError(error), await getT()) };
  }
}

export async function loadThreadAction(tenant: string, threadId: string): Promise<UiTurn[]> {
  const ctx = await tenantCtx(tenant);
  if (!(await threadBelongsTo(ctx, threadId))) return [];
  return toUiTurns(await loadThread(ctx, threadId));
}

export async function listThreadsAction(tenant: string) {
  const ctx = await tenantCtx(tenant);
  return listThreads(ctx, 15);
}

export async function inboxAction(tenant: string): Promise<InboxItem[]> {
  const ctx = await tenantCtx(tenant);
  return listInbox(ctx, { status: ["new", "processing", "needs_you", "failed"], limit: 30 });
}

export async function dismissInboxAction(tenant: string, id: number): Promise<void> {
  const ctx = await tenantCtx(tenant);
  await updateInboxItem(ctx, id, { status: "done" });
  revalidatePath(`/${tenant}`);
}
