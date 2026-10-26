import { handleApiRequest, handleEmail } from "@batzio/server/http";
import { handleCompatRequest } from "@batzio/server/compat/index";

const notFound = (path: string) =>
  new Response(JSON.stringify({ error: { code: "not_found", message: `No endpoint ${path}. Start at /api/v1.` } }), {
    status: 404,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

/**
 * Batzio's headless API Worker: the REST API, MCP, Batzi's agent stream, file
 * drops and inbound email, without the web UI. The native apps talk to it.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    const response = await handleApiRequest(request);
    if (response) return response;
    const url = new URL(request.url);
    // The compatibility API also answers at the root, so existing clients only change the host.
    if (/^\/[234]\.0\//.test(url.pathname)) return handleCompatRequest(request, url.pathname);
    if (url.pathname === "/" || url.pathname === "/api") return Response.redirect(`${url.origin}/api/v1`, 302);
    return notFound(url.pathname);
  },
  email: handleEmail,
};
