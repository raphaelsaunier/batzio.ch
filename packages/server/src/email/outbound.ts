import type { Ctx } from "../ctx";
import { getEnv } from "../env";
import { AppError } from "../errors";
import { getSettings } from "../settings";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; type: string; bytes: Uint8Array }[];
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Whether this deployment can send email (Cloudflare Email Service binding `EMAIL` and `EMAIL_FROM`). */
export function canSendEmail(): boolean {
  const env = getEnv();
  return !!env.EMAIL && !!env.EMAIL_FROM;
}

/**
 * Sends a document to a customer through Cloudflare Email Service, in the
 * company's name; replies go to the company's own address.
 */
export async function sendMail(ctx: Ctx, mail: OutgoingMail): Promise<string> {
  const env = getEnv();
  if (!env.EMAIL || !env.EMAIL_FROM) {
    throw new AppError("conflict", "Sending email is not set up for this Batzio installation (EMAIL binding and EMAIL_FROM).");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.to)) throw new AppError("validation", "Enter a valid email address.");
  const company = await getSettings(ctx, "company");
  const result = await env.EMAIL.send({
    to: mail.to,
    from: { email: env.EMAIL_FROM, name: company.name || ctx.tenant.name },
    replyTo: company.email || undefined,
    subject: mail.subject,
    text: mail.text,
    attachments: mail.attachments?.map((a) => ({ content: base64(a.bytes), filename: a.filename, type: a.type, disposition: "attachment" as const })),
  });
  return result.messageId;
}
