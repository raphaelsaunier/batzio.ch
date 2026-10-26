import { isLocale } from "@batzio/i18n";
import { CATALOG_VERSION, messagesFor } from "@batzio/i18n/server";

/** One language's catalog; versioned URLs (`?v=`) are cached forever. */
export async function GET(request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) return new Response("Unknown language", { status: 404 });
  const versioned = new URL(request.url).searchParams.get("v") === CATALOG_VERSION;
  return new Response(JSON.stringify(messagesFor(locale)), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=300",
    },
  });
}
