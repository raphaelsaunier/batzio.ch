import { isLocale, LOCALE_COOKIE, negotiateLocale, DEFAULT_LOCALE } from "@batzio/i18n";
import { originFrom, shareTags } from "@/lib/share";

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Interactive API reference rendered by Scalar from the generated OpenAPI document. */
export function GET(request: Request): Response {
  const origin = new URL(request.url).origin;
  const cookie = request.headers.get("cookie")?.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([a-z]{2})`))?.[1];
  const locale = isLocale(cookie) ? cookie : (negotiateLocale(request.headers.get("accept-language")) ?? DEFAULT_LOCALE);
  const share = shareTags("api", locale, originFrom(request.headers.get("host"), request.headers.get("x-forwarded-proto")));
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Batzio API reference</title>
    <link rel="icon" href="/favicon.svg" />
    <meta name="description" content="${attr(share.description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Batzio" />
    <meta property="og:title" content="${attr(`Batzio — ${share.title}`)}" />
    <meta property="og:description" content="${attr(share.description)}" />
    <meta property="og:locale" content="${share.ogLocale}" />
    <meta property="og:image" content="${share.image}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${share.image}" />
    <style>
      :root { --scalar-color-accent: #2f5f8f; --scalar-font: Inter, system-ui, sans-serif; }
      body { margin: 0; background: #f8fafc; }
    </style>
  </head>
  <body>
    <script id="api-reference" data-url="${origin}/api/v1/openapi.json"></script>
    <script>
      document.getElementById("api-reference").dataset.configuration = JSON.stringify({
        theme: "default",
        layout: "modern",
        hideClientButton: false,
        defaultHttpClient: { targetKey: "shell", clientKey: "curl" },
        metaData: { title: "Batzio API reference" },
      });
    </script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.73.1"></script>
  </body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
