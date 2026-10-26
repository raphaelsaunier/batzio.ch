import { COMPAT_PREFIX, handleCompatRequest } from "@batzio/server/compat/index";

/** The compatibility API (/api/compat/2.0/…, 3.0, 4.0), shared with the API Worker. */
async function handler(request: Request): Promise<Response> {
  return handleCompatRequest(request, new URL(request.url).pathname.slice(COMPAT_PREFIX.length));
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
