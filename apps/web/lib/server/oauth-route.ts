import { handleOauthHttp } from "@batzio/server/oauth";

/** Discovery, registration, token and revocation. The consent screen is a page. */
export async function oauthRoute(request: Request): Promise<Response> {
  return (await handleOauthHttp(request)) ?? new Response("Not found", { status: 404 });
}
