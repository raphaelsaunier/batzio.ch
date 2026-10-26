import { apiContext } from "./api/context";
import { AppError } from "./errors";

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Keys are remembered for a day: enough for any retry, short enough to stay small. */
const TTL_MS = 24 * 60 * 60 * 1000;

interface KeyRow {
  key: string;
  method: string;
  path: string;
  status: number;
  body: string;
}

/**
 * `Idempotency-Key` for writes: a request sent again with the same key (a retry
 * after a timeout, a double tap, an agent repeating itself) gets the first
 * answer back instead of creating a second invoice. Only successful JSON
 * answers are kept; failures can simply be retried.
 */
export async function withIdempotency(request: Request, handler: () => Promise<Response>): Promise<Response> {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || !WRITES.has(request.method)) return handler();
  if (key.length > 120) throw new AppError("validation", "Idempotency-Key must be at most 120 characters.");
  // Unauthenticated requests are answered (and rejected) by the handler itself.
  const ctx = await apiContext(request).catch(() => null);
  if (!ctx) return handler();
  const url = new URL(request.url);
  const path = `${url.pathname}?tenant=${ctx.tenant.slug}`;

  const existing = await ctx.db.first<KeyRow>("SELECT * FROM idempotency_keys WHERE key = ?", key);
  if (existing) {
    if (existing.method !== request.method || existing.path !== path) {
      throw new AppError("validation", "This Idempotency-Key was already used for a different request.");
    }
    if (existing.status === 0) throw new AppError("conflict", "The same request is still being processed.");
    return new Response(existing.body, {
      status: existing.status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Idempotent-Replayed": "true" },
    });
  }

  await ctx.db.run("DELETE FROM idempotency_keys WHERE created_at < ?", new Date(Date.now() - TTL_MS).toISOString());
  // Claim the key first, so two copies of a request racing each other cannot both run.
  const claimed = await ctx.db.run("INSERT OR IGNORE INTO idempotency_keys (key, method, path, status, body) VALUES (?, ?, ?, 0, '')", key, request.method, path);
  if (!claimed.changes) throw new AppError("conflict", "The same request is still being processed.");

  let response: Response;
  try {
    response = await handler();
  } catch (error) {
    await ctx.db.run("DELETE FROM idempotency_keys WHERE key = ?", key);
    throw error;
  }
  const json = response.headers.get("content-type")?.includes("application/json");
  if (response.ok && json) {
    await ctx.db.run("UPDATE idempotency_keys SET status = ?, body = ? WHERE key = ?", response.status, await response.clone().text(), key);
  } else {
    await ctx.db.run("DELETE FROM idempotency_keys WHERE key = ?", key);
  }
  return response;
}
