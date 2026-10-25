import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from "pdf-lib";

export const MM = 72 / 25.4;
export const A4 = { width: 210 * MM, height: 297 * MM };

export const COLORS = {
  text: rgb(0.12, 0.15, 0.2),
  muted: rgb(0.42, 0.46, 0.52),
  line: rgb(0.83, 0.86, 0.9),
  accent: rgb(0.184, 0.373, 0.561),
  accentLight: rgb(0.93, 0.95, 0.98),
  white: rgb(1, 1, 1),
  danger: rgb(0.7, 0.15, 0.15),
};

/** Replace characters outside WinAnsi (standard PDF fonts) with close equivalents. */
export function sanitize(text: string): string {
  return text
    .replace(/[‘‚‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/−/g, "-")
    .replace(/[   ]/g, " ")
    .replace(/[^\u0000-ÿ’–—•€…™ŒœŠšŸŽžƒˆ˜“”]/g, "?");
}

export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of sanitize(text).split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      // Break overlong words.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

export interface TextOpts {
  size?: number;
  bold?: boolean;
  color?: ReturnType<typeof rgb>;
  align?: "left" | "right" | "center";
  width?: number;
}

/**
 * Flowing A4 document: tracks a cursor from the top and adds pages as needed.
 * Coordinates passed to helpers are in points from the top-left corner.
 */
export class PdfWriter {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  /** Pages whose bottom area is used otherwise (e.g. QR-bill) and get no footer. */
  noFooter = new Set<PDFPage>();
  onNewPage?: (w: PdfWriter) => void;

  private constructor(
    readonly doc: PDFDocument,
    readonly font: PDFFont,
    readonly bold: PDFFont,
    readonly margin = { top: 20 * MM, bottom: 22 * MM, left: 20 * MM, right: 18 * MM },
  ) {}

  static async create(meta: { title: string; author?: string }) {
    const doc = await PDFDocument.create();
    doc.setTitle(sanitize(meta.title));
    doc.setAuthor(sanitize(meta.author ?? "Batzio"));
    doc.setCreator("Batzio");
    doc.setProducer("Batzio");
    const w = new PdfWriter(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
    w.addPage();
    return w;
  }

  get contentWidth() {
    return A4.width - this.margin.left - this.margin.right;
  }

  addPage() {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.pages.push(this.page);
    this.y = this.margin.top;
    this.onNewPage?.(this);
  }

  /** Ensures `height` points are available above the bottom margin (plus `reserve`). */
  ensure(height: number, reserve = 0) {
    if (this.y + height > A4.height - this.margin.bottom - reserve) this.addPage();
  }

  remaining(reserve = 0) {
    return A4.height - this.margin.bottom - reserve - this.y;
  }

  text(value: string, x: number, y: number, opts: TextOpts = {}) {
    const font = opts.bold ? this.bold : this.font;
    const size = opts.size ?? 9;
    const str = sanitize(value);
    let dx = x;
    if (opts.align === "right") dx = x - font.widthOfTextAtSize(str, size);
    if (opts.align === "center") dx = x - font.widthOfTextAtSize(str, size) / 2;
    this.page.drawText(str, { x: dx, y: A4.height - y - size * 0.8, size, font, color: opts.color ?? COLORS.text });
  }

  /** Draws wrapped text and returns its height. */
  paragraph(value: string, x: number, y: number, width: number, opts: TextOpts & { lineHeight?: number } = {}) {
    const size = opts.size ?? 9;
    const lh = opts.lineHeight ?? size * 1.35;
    const lines = wrap(value, opts.bold ? this.bold : this.font, size, width);
    lines.forEach((l, i) => this.text(l, opts.align === "right" ? x + width : x, y + i * lh, opts));
    return lines.length * lh;
  }

  measure(value: string, width: number, size = 9, bold = false, lineHeight?: number) {
    return wrap(value, bold ? this.bold : this.font, size, width).length * (lineHeight ?? size * 1.35);
  }

  line(x1: number, y1: number, x2: number, y2: number, opts: { color?: ReturnType<typeof rgb>; thickness?: number; dash?: number[] } = {}) {
    this.page.drawLine({
      start: { x: x1, y: A4.height - y1 },
      end: { x: x2, y: A4.height - y2 },
      thickness: opts.thickness ?? 0.5,
      color: opts.color ?? COLORS.line,
      dashArray: opts.dash,
    });
  }

  rect(x: number, y: number, w: number, h: number, color: ReturnType<typeof rgb>) {
    this.page.drawRectangle({ x, y: A4.height - y - h, width: w, height: h, color });
  }

  /** Adds "Page x / y" footers and an optional footer line on every page. */
  finalizeFooters(footer?: string, label = "Page") {
    const total = this.pages.length;
    this.pages.forEach((p, i) => {
      if (this.noFooter.has(p)) return;
      const y = 12 * MM;
      if (footer) {
        p.drawText(sanitize(footer), { x: this.margin.left, y, size: 7, font: this.font, color: COLORS.muted });
      }
      const pageLabel = `${label} ${i + 1}/${total}`;
      p.drawText(pageLabel, {
        x: A4.width - this.margin.right - this.font.widthOfTextAtSize(pageLabel, 7),
        y,
        size: 7,
        font: this.font,
        color: COLORS.muted,
      });
    });
  }

  async save(): Promise<Uint8Array> {
    return this.doc.save();
  }
}

/** "#2f5f8f" → pdf-lib colour plus a very light tint for table headers. */
export function brandColors(hex: string | null | undefined) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return { accent: COLORS.accent, accentLight: COLORS.accentLight };
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const tint = (v: number) => v + (1 - v) * 0.92;
  return { accent: rgb(r, g, b), accentLight: rgb(tint(r), tint(g), tint(b)) };
}

export async function embedImage(doc: PDFDocument, bytes: Uint8Array, mime: string | null): Promise<PDFImage | null> {
  try {
    if (mime === "image/png") return await doc.embedPng(bytes);
    if (mime === "image/jpeg" || mime === "image/jpg") return await doc.embedJpg(bytes);
  } catch {
    return null;
  }
  return null;
}

export function pdfResponse(bytes: Uint8Array, filename: string, inline = true): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replace(/[^\w.-]+/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
