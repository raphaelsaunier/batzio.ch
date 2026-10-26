/**
 * `Content-Disposition` for any file name (RFC 6266): an ASCII fallback for old
 * clients plus the exact name in UTF-8, so “Quittung Café.pdf” survives a download.
 */
export function contentDisposition(name: string, inline = false): string {
  const fallback =
    name
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7e]+/g, "_")
      .replace(/["\\]/g, "") || "file";
  const exact = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${exact}`;
}

/** A file name safe to store anywhere: keeps letters of every language, drops path and control characters. */
export function safeFileName(name: string): string {
  return (
    name
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, "_")
      .trim()
      .slice(0, 120) || "file"
  );
}
