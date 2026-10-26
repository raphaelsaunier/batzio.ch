/** Interactive API reference rendered by Scalar from the generated OpenAPI document. */
export function GET(request: Request): Response {
  const origin = new URL(request.url).origin;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Batzio API reference</title>
    <link rel="icon" href="/favicon.svg" />
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
