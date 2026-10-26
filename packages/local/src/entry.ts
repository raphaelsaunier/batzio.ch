/**
 * Batzio's engine, packaged to run inside the native apps without a server:
 * the same REST API the apps use online, over SQLite files and a folder the
 * app manages (see host-api.ts). Built into one script by scripts/build.mjs.
 *
 *   BatzioLocal.configure('{"tenantSlots": 20}')
 *   BatzioLocal.dispatch("1", '{"method":"GET","url":"https://device.batzio.local/api/v1/auth/me","headers":[...],"body":null}')
 *     → __batzio_host.respond("1", '{"status":200,"headers":[...],"body":"<base64>"}')
 */
import "./runtime";
import { handleAgent, handleDrop } from "@batzio/server/agent/http";
import { handleApi } from "@batzio/server/api/router";
import { fromBase64, toBase64 } from "./bytes";
import { host } from "./host-api";
import { HostBucket, HostDatabase } from "./storage";
import { env } from "./shims/workers-env";

/** The address the apps use for the engine on the device. */
const LOCAL_ORIGIN = "https://device.batzio.local";

interface WireRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body: string | null;
}

interface WireResponse {
  status: number;
  headers: [string, string][];
  body: string;
}

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

async function route(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
    return handleApi(request, pathname.slice("/api/v1".length).split("/").filter(Boolean).map(decodeURIComponent));
  }
  if (pathname === "/api/drop" && request.method === "POST") return handleDrop(request);
  if (pathname === "/api/agent" && request.method === "POST") return handleAgent(request);
  return json(404, { error: { code: "not_found", message: "This is not available when Batzio works on this device only." } });
}

async function handle(wire: WireRequest): Promise<WireResponse> {
  const request = new Request(wire.url, { method: wire.method, headers: wire.headers, body: wire.body === null ? undefined : (fromBase64(wire.body) as BodyInit) });
  let response: Response;
  try {
    response = await route(request);
  } catch (error) {
    console.error(error);
    response = json(500, { error: { code: "internal", message: error instanceof Error ? error.message : String(error) } });
  }
  const headers: [string, string][] = [];
  response.headers.forEach((value, key) => headers.push([key, value]));
  return { status: response.status, headers, body: toBase64(new Uint8Array(await response.arrayBuffer())) };
}

function configure(options: { tenantSlots?: number; appUrl?: string } = {}) {
  env.DB = new HostDatabase("DB");
  env.FILES = new HostBucket();
  env.APP_URL = options.appUrl ?? LOCAL_ORIGIN;
  for (let i = 1; i <= (options.tenantSlots ?? 20); i++) {
    const binding = `TENANT_DB_${String(i).padStart(3, "0")}`;
    env[binding] = new HostDatabase(binding);
  }
}

const api = {
  version: 1,
  origin: LOCAL_ORIGIN,
  configure: (options?: string) => configure(options ? JSON.parse(options) : {}),
  /** Handles one request; the answer arrives through `__batzio_host.respond(id, json)`. */
  dispatch(id: string, request: string) {
    handle(JSON.parse(request) as WireRequest).then(
      (response) => host().respond(id, JSON.stringify(response)),
      (error) => host().respond(id, JSON.stringify({ status: 500, headers: [["content-type", "application/json"]], body: toBase64(new TextEncoder().encode(JSON.stringify({ error: { code: "internal", message: String(error) } }))) })),
    );
  },
};

(globalThis as { BatzioLocal?: typeof api }).BatzioLocal = api;
