import { handleAgent, handleDrop } from "./agent/http";
import { handleApi } from "./api/router";
import { COMPAT_PREFIX, handleCompatRequest } from "./compat";
import { handleEmailEvent, type InboundMessage } from "./email/inbound";
import type { AppEnv } from "./env";
import { handleMcp } from "./mcp/http";

/**
 * Every Batzio endpoint under /api: REST (/api/v1), the compatibility API
 * (/api/compat), MCP (/api/mcp), the agent stream (/api/agent) and file drops
 * (/api/drop). Mounted by the headless API Worker (apps/api) and by the web
 * app, so both behave identically.
 */
export async function handleApiRequest(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
    const segments = pathname.slice("/api/v1".length).split("/").filter(Boolean).map(decodeURIComponent);
    return handleApi(request, segments);
  }
  if (pathname.startsWith(`${COMPAT_PREFIX}/`)) return handleCompatRequest(request, pathname.slice(COMPAT_PREFIX.length));
  if (pathname === "/api/mcp") return handleMcp(request);
  if (pathname === "/api/agent" && request.method === "POST") return handleAgent(request);
  if (pathname === "/api/drop" && request.method === "POST") return handleDrop(request);
  return null;
}

/** Workers `email()` handler: mail routed to the inbox domain lands in a company's inbox. */
export async function handleEmail(message: InboundMessage, env: AppEnv, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
  try {
    await handleEmailEvent(message, env, (p) => ctx.waitUntil(p.catch((e) => console.error("inbox processing failed", e))));
  } catch (error) {
    console.error("inbound email failed", error);
    message.setReject("Batzio could not accept this message right now.");
  }
}
