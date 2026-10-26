import { handleApi } from "@batzio/server/api/router";

type Context = { params: Promise<{ path?: string[] }> };

async function handler(request: Request, { params }: Context): Promise<Response> {
  const { path = [] } = await params;
  return handleApi(request, path);
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
