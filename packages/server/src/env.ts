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
  /** Cloudflare Email Service send binding, for sending documents to customers. */
  EMAIL?: SendEmailBinding;
  /** Sender address for outgoing documents, on a domain onboarded to Email Sending. */
  EMAIL_FROM?: string;
  /** API origin the one-click importer reads from (an API like /api/compat), pre-filled on the Move in page. */
  IMPORT_SOURCE_URL?: string;
  /** A shared demo account shown on the sign-in page with a one-click login (created with demo data on first use). */
  DEMO_LOGIN_EMAIL?: string;
  DEMO_LOGIN_PASSWORD?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_D1_TOKEN?: string;
  [binding: string]: unknown;
}

/** The parts of the `send_email` binding Batzio uses. */
export interface SendEmailBinding {
  send(message: {
    to: string | string[];
    from: string | { email: string; name?: string };
    replyTo?: string;
    subject: string;
    text?: string;
    html?: string;
    attachments?: { content: string; filename: string; type: string; disposition: "attachment" | "inline" }[];
  }): Promise<{ messageId: string }>;
}

export function getEnv(): AppEnv {
  return workerEnv as unknown as AppEnv;
}
