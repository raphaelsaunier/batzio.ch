import { can, type Area, type Role } from "@batzio/core/permissions";
import type { Db } from "./db/db";
import type { R2LikeBucket } from "./db/types";
import { AppError } from "./errors";

export type Source = "ui" | "app" | "api" | "mcp" | "agent" | "email" | "system";

export interface Actor {
  type: "user" | "api_key" | "system";
  id: string | null;
  name: string;
  source: Source;
  ip?: string | null;
  userAgent?: string | null;
  /**
   * Provenance recorded with every change: the Batzi conversation and tool, the MCP
   * client, the API request, the quick sentence, the email, the import…
   */
  context?: Record<string, string | number | boolean | null>;
}

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  locale: string;
}

/** Everything a domain operation needs: who is acting, on which tenant, with which database. */
export interface Ctx {
  tenant: TenantInfo;
  user: { id: string; name: string; email: string } | null;
  role: Role;
  /** Write scope of API keys; UI sessions always have "write". */
  scope: "read" | "write";
  actor: Actor;
  db: Db;
  control: Db;
  files?: R2LikeBucket;
}

export function canCtx(ctx: Ctx, area: Area, level: "read" | "write" = "read"): boolean {
  if (level === "write" && ctx.scope === "read") return false;
  return can(ctx.role, area, level);
}

export function assertCan(ctx: Ctx, area: Area, level: "read" | "write" = "read"): void {
  if (!canCtx(ctx, area, level)) {
    throw level === "write" && ctx.scope === "read"
      ? new AppError("forbidden", "This API key is read-only.")
      : new AppError("forbidden", "Your role does not allow {level} access to {area}.", undefined, { level, area });
  }
}

/** The same context with more provenance for the audit log (merged into `actor.context`). */
export function withProvenance(ctx: Ctx, context: Record<string, string | number | boolean | null | undefined>): Ctx {
  const clean = Object.fromEntries(Object.entries(context).filter(([, v]) => v !== undefined && v !== "")) as Record<string, string | number | boolean | null>;
  return { ...ctx, actor: { ...ctx.actor, context: { ...ctx.actor.context, ...clean } } };
}

/** Changes made by software rather than a person clicking: Batzi, MCP clients, API scripts, email, imports, Batzio itself. */
export function isAutomated(source: string): boolean {
  return source !== "ui" && source !== "app";
}

/** A system context for background jobs and seeding. */
export function systemCtx(base: Omit<Ctx, "actor" | "role" | "scope" | "user">): Ctx {
  return {
    ...base,
    user: null,
    role: "owner",
    scope: "write",
    actor: { type: "system", id: null, name: "Batzio", source: "system" },
  };
}
