import type { Metadata } from "next";
import { headers } from "next/headers";
import { N_, type Locale } from "@batzio/i18n";
import { getEnv } from "@batzio/server/env";
import { getLocale, tFor } from "@/lib/i18n/server";

/** Open-graph images rendered by `pnpm --filter @batzio/web og` into public/og. */
export type ShareImage = "home" | "demo" | "api";

const OG_LOCALES: Record<Locale, string> = { en: "en_GB", de: "de_CH", fr: "fr_CH", it: "it_CH" };

const COPY: Record<ShareImage, { title: string; description: string }> = {
  home: {
    title: N_("Swiss accounting that keeps up with you"),
    description: N_("Instant on every device, ready for your AI assistant, compatible with the tools you already use."),
  },
  demo: {
    title: N_("A year of Swiss books, ready to explore"),
    description: N_("Invoices, bills, payroll and bank statements of a demo agency — one click, nothing to set up."),
  },
  api: {
    title: N_("One API for all your books"),
    description: N_("REST with OpenAPI, an MCP server for AI agents, and drop-in compatibility with your current accounting software."),
  },
};

/** The public origin: APP_URL in production, the request's own host on previews and locally. */
export function originFrom(host: string | null, forwardedProto?: string | null): string {
  const app = getEnv().APP_URL;
  if (app) return app.replace(/\/$/, "");
  const h = host ?? "localhost";
  const local = /^(localhost|127\.|\[::1\])/.test(h);
  return `${forwardedProto ?? (local ? "http" : "https")}://${h}`;
}

/** Title, description and the matching sharing image for a page, in the reader's language. */
export function shareTags(image: ShareImage, locale: Locale, origin: string) {
  const t = tFor(locale);
  const title = t(COPY[image].title);
  const description = t(COPY[image].description);
  return { title, description, image: `${origin}/og/${image}-${locale}.jpg`, ogLocale: OG_LOCALES[locale] };
}

export async function shareMetadata(image: ShareImage): Promise<Metadata> {
  const [locale, h] = await Promise.all([getLocale(), headers()]);
  const origin = originFrom(h.get("x-forwarded-host") ?? h.get("host"), h.get("x-forwarded-proto"));
  const tags = shareTags(image, locale, origin);
  const images = [{ url: tags.image, width: 1200, height: 630, alt: tags.title }];
  return {
    metadataBase: new URL(origin),
    description: tags.description,
    openGraph: { type: "website", siteName: "Batzio", title: `Batzio — ${tags.title}`, description: tags.description, locale: tags.ogLocale, images },
    twitter: { card: "summary_large_image", title: `Batzio — ${tags.title}`, description: tags.description, images },
  };
}
