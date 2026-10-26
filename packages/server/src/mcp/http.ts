import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { apiContext } from "../api/context";
import { createMcpServer } from "./server";
import { toAppError } from "../errors";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

function jsonRpcError(status: number, message: string, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: status === 401 ? -32001 : -32000, message }, id: null }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS, ...extra },
  });
}

/** Stateless Streamable HTTP MCP endpoint. Authenticate with `Authorization: Bearer <API key>`. */
export async function handleMcpPost(request: Request): Promise<Response> {
  let ctx;
  try {
    ctx = await apiContext(request, "mcp");
  } catch (error) {
    const e = toAppError(error);
    return jsonRpcError(e.status, e.message, e.status === 401 ? { "WWW-Authenticate": 'Bearer realm="batzio"' } : {});
  }
  const server = createMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, headers });
}

export function handleMcpGet(): Response {
  return jsonRpcError(405, "This MCP endpoint is stateless; use POST.", { Allow: "POST, OPTIONS" });
}

export function handleMcpDelete(): Response {
  return jsonRpcError(405, "Sessions are not used by this endpoint.", { Allow: "POST, OPTIONS" });
}

export function handleMcpOptions(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/** /api/mcp for any HTTP method. */
export function handleMcp(request: Request): Promise<Response> | Response {
  switch (request.method.toUpperCase()) {
    case "POST":
      return handleMcpPost(request);
    case "OPTIONS":
      return handleMcpOptions();
    case "DELETE":
      return handleMcpDelete();
    default:
      return handleMcpGet();
  }
}
