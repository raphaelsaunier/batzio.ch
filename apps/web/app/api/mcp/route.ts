import { handleMcpDelete, handleMcpGet, handleMcpOptions, handleMcpPost } from "@batzio/server/mcp/http";

/** Stateless Streamable HTTP MCP endpoint. Authenticate with `Authorization: Bearer <API key>`. */
export const POST = (request: Request) => handleMcpPost(request);
export const GET = () => handleMcpGet();
export const DELETE = () => handleMcpDelete();
export const OPTIONS = () => handleMcpOptions();
