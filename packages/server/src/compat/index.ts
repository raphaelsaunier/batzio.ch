import { apiContext } from "../api/context";
import type { Ctx } from "../ctx";
import { AppError, toAppError } from "../errors";
import { contactRoutes } from "./v2-contacts";
import { documentRoutesAll } from "./v2-documents";
import { itemRoutes } from "./v2-items";
import { projectRoutes } from "./v2-projects";
import { v3Routes } from "./v3";
import { v4Routes } from "./v4";
import { errorBody, Reply, type Route } from "./wire";

/**
 * The compatibility API: the REST endpoints existing Swiss accounting
 * integrations already call (`/2.0`, `/3.0`, `/4.0`), served from Batzio's
 * data. Point a client's base URL at `https://<host>/api/compat`, give it a
 * Batzio API key, and it keeps working.
 */
export const COMPAT_PREFIX = "/api/compat";

interface Compiled {
  route: Route;
  pattern: RegExp;
  names: string[];
  /** Literal segments win over parameters (`/users/me` before `/users/{id}`). */
  rank: number;
}

let compiled: Compiled[] | null = null;

export function compatRoutes(): Route[] {
  return [...contactRoutes(), ...itemRoutes(), ...documentRoutesAll(), ...projectRoutes(), ...v3Routes(), ...v4Routes()];
}

function compile(): Compiled[] {
  if (compiled) return compiled;
  compiled = compatRoutes()
    .map((route) => {
      const names: string[] = [];
      const parts = route.path.split("/").filter(Boolean);
      const pattern = new RegExp(
        `^/${parts
          .map((p) => {
            const m = /^\{(\w+)\}$/.exec(p);
            if (!m) return p.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
            names.push(m[1]);
            return "([^/]+)";
          })
          .join("/")}/?$`,
      );
      const rank = parts.reduce((n, p, i) => n + (p.startsWith("{") ? 0 : 1) * 2 ** (parts.length - i), 0);
      return { route, pattern, names, rank };
    })
    .sort((a, b) => b.rank - a.rank);
  return compiled;
}

function match(method: string, path: string) {
  let pathMatched = false;
  for (const c of compile()) {
    const m = c.pattern.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (c.route.method !== method) continue;
    const params = Object.fromEntries(c.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    return { route: c.route, params };
  }
  return pathMatched ? "method" : null;
}

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body ?? null), {
    status,
    headers: status === 204 ? {} : { "Content-Type": "application/json; charset=utf-8" },
  });

/** A read-only key may still search (POST …/search). */
const isRead = (method: string, path: string) => method === "GET" || method === "HEAD" || /\/search$/.test(path);

async function readBody(request: Request): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "DELETE") return null;
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) return null;
  const text = await request.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("validation", "The request body is not valid JSON.");
  }
}

/** Handles `/api/compat/<version>/…`; `path` is the part after the prefix. */
export async function handleCompatRequest(request: Request, path: string): Promise<Response> {
  if (request.method.toUpperCase() === "OPTIONS") return new Response(null, { status: 204, headers: { Allow: "GET, POST, PUT, PATCH, DELETE" } });
  return dispatchCompat(() => apiContext(request, "api"), request, path);
}

/** Routes one request for an authenticated company (tests pass their own context). */
export async function dispatchCompat(context: () => Promise<Ctx>, request: Request, path: string): Promise<Response> {
  const method = request.method.toUpperCase();
  const found = match(method === "HEAD" ? "GET" : method, path);
  if (found === null) return json(404, errorBody(404, "Not Found"));
  if (found === "method") return json(405, errorBody(405, "Method Not Allowed"));
  try {
    const ctx = await context();
    if (ctx.scope === "read" && !isRead(method, path)) throw new AppError("forbidden", "This API key is read-only.");
    const query = new URL(request.url).searchParams;
    const body = await readBody(request);
    const result = await found.route.handler({ ctx, request, params: found.params, query, body });
    if (result instanceof Reply) return result.response ?? json(result.status, result.body);
    return json(200, result);
  } catch (error) {
    // Constraint violations (duplicate numbers, missing or still-used references) become 409s.
    const e = toAppError(error);
    return json(e.status, errorBody(e.status, e.status === 500 ? "Internal Server Error" : e.message));
  }
}
