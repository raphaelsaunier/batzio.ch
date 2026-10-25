import { env as workerEnv } from "cloudflare:workers";
import type { D1LikeDatabase, R2LikeBucket } from "./db/types";

/** Bindings and variables available to the Worker. */
export interface AppEnv {
  /** Control plane database. */
  DB: D1LikeDatabase;
  /** Object storage for attachments. */
  FILES?: R2LikeBucket;
  APP_URL?: string;
  /** Enables Batzi, the Claude-powered assistant. */
  ANTHROPIC_API_KEY?: string;
  /** Domain whose inbound mail is routed to this Worker (Email Routing), e.g. in.batzio.ch. */
  EMAIL_DOMAIN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_D1_TOKEN?: string;
  [binding: string]: unknown;
}

export function getEnv(): AppEnv {
  return workerEnv as unknown as AppEnv;
}
