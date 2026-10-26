import { listMembers, type MemberRow } from "../control";
import type { Ctx } from "../ctx";
import type { Row } from "../resources/types";

/** Lookups the wire format needs (countries, languages and currencies by id), cached per request. */
const caches = new WeakMap<Ctx, Map<string, Promise<unknown>>>();

function memo<T>(ctx: Ctx, key: string, load: () => Promise<T>): Promise<T> {
  let cache = caches.get(ctx);
  if (!cache) caches.set(ctx, (cache = new Map()));
  if (!cache.has(key)) cache.set(key, load());
  return cache.get(key) as Promise<T>;
}

/** Forget cached lookups after a write that changes them. */
export function invalidate(ctx: Ctx, key: string) {
  caches.get(ctx)?.delete(key);
}

interface CodeTable {
  byId: Map<number, Row>;
  byCode: Map<string, Row>;
}

function codeTable(ctx: Ctx, table: string): Promise<CodeTable> {
  return memo(ctx, table, async () => {
    const rows = await ctx.db.all<Row>(`SELECT * FROM ${table} ORDER BY id`);
    return {
      byId: new Map(rows.map((r) => [Number(r.id), r])),
      byCode: new Map(rows.map((r) => [String(r.code).toUpperCase(), r])),
    };
  });
}

const idOf = async (ctx: Ctx, table: string, code: unknown) =>
  code ? Number((await codeTable(ctx, table)).byCode.get(String(code).toUpperCase())?.id ?? 0) || null : null;
const codeOf = async (ctx: Ctx, table: string, id: unknown) => (id ? ((await codeTable(ctx, table)).byId.get(Number(id))?.code as string | undefined) ?? null : null);

export const countryId = (ctx: Ctx, code: unknown) => idOf(ctx, "countries", code);
export const countryCode = (ctx: Ctx, id: unknown) => codeOf(ctx, "countries", id);
export const languageId = (ctx: Ctx, code: unknown) => idOf(ctx, "languages", code);
export const languageCode = async (ctx: Ctx, id: unknown) => (await codeOf(ctx, "languages", id))?.toLowerCase() ?? null;
export const currencyId = (ctx: Ctx, code: unknown) => idOf(ctx, "currencies", code ?? "CHF");
export const currencyCode = (ctx: Ctx, id: unknown) => codeOf(ctx, "currencies", id);
export const countries = (ctx: Ctx) => codeTable(ctx, "countries");
export const languages = (ctx: Ctx) => codeTable(ctx, "languages");
export const currencies = (ctx: Ctx) => codeTable(ctx, "currencies");

export async function unitId(ctx: Ctx, name: unknown): Promise<number | null> {
  if (!name) return null;
  const units = await memo(ctx, "units", () => ctx.db.all<Row>("SELECT id, name FROM units"));
  return Number(units.find((u) => String(u.name).toLowerCase() === String(name).toLowerCase())?.id ?? 0) || null;
}

export async function unitName(ctx: Ctx, id: unknown): Promise<string | null> {
  if (!id) return null;
  const units = await memo(ctx, "units", () => ctx.db.all<Row>("SELECT id, name FROM units"));
  return (units.find((u) => Number(u.id) === Number(id))?.name as string | undefined) ?? null;
}

export async function taxRate(ctx: Ctx, id: unknown): Promise<number | null> {
  if (!id) return null;
  const taxes = await memo(ctx, "taxes", () => ctx.db.all<Row>("SELECT id, rate FROM taxes"));
  const hit = taxes.find((t) => Number(t.id) === Number(id));
  return hit ? Number(hit.rate) : null;
}

// ------------------------------------------------------------------ users

/** Wire user ids are integers; Batzio's are strings. A stable 31-bit number per user. */
export function userNumber(id: string | null | undefined): number {
  if (!id) return 1;
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1) || 1;
}

export const members = (ctx: Ctx) => memo(ctx, "members", () => listMembers(ctx.control, ctx.tenant.id));

export async function memberByNumber(ctx: Ctx, n: unknown): Promise<MemberRow | null> {
  if (n === null || n === undefined || n === "") return null;
  return (await members(ctx)).find((m) => userNumber(m.user_id) === Number(n)) ?? null;
}

export async function userIdFor(ctx: Ctx, n: unknown): Promise<string | null> {
  return (await memberByNumber(ctx, n))?.user_id ?? null;
}

/** The number for a stored user id, falling back to the caller. */
export const userOf = (ctx: Ctx, id: unknown) => userNumber(id ? String(id) : ctx.user?.id);
