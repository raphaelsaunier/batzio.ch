import handler from "vinext/server/fetch-handler";
import { handleEmailEvent, type InboundMessage } from "../lib/server/email/inbound";
import type { AppEnv } from "../lib/server/env";

/**
 * Worker entry: the vinext app handles HTTP; email() receives mail routed to
 * the company inbox addresses by Cloudflare Email Routing.
 */
export default {
  ...handler,
  fetch: handler.fetch,
  async email(message: InboundMessage, env: AppEnv, ctx: { waitUntil(p: Promise<unknown>): void }) {
    try {
      await handleEmailEvent(message, env, (p) => ctx.waitUntil(p.catch((e) => console.error("inbox processing failed", e))));
    } catch (error) {
      console.error("inbound email failed", error);
      message.setReject("Batzio could not accept this message right now.");
    }
  },
};
