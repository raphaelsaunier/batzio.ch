import { calculateDocument } from "@/lib/calc/documents";
import { formatAmount, formatDate, formatDecimal } from "@/lib/format";
import { fromCents } from "@/lib/money";
import { formatIban, isValidIban } from "@/lib/swiss/iban";
import type { QrBillData } from "@/lib/swiss/qr-bill";
import { createScorReference } from "@/lib/swiss/references";
import type { Ctx } from "../ctx";
import { loadContact, roundingStep, type ContactRow, type DocumentRow } from "../sales";
import { getSettings, type CompanySettings } from "../settings";
import type { PDFImage } from "pdf-lib";
import { readFile } from "../files";
import { A4, brandColors, COLORS, embedImage, MM, PdfWriter } from "./base";
import { t, type LabelKey } from "./i18n";
import { drawQrBill, QR_SLIP_HEIGHT } from "./qr-bill";

interface BankRow {
  iban: string | null;
  qr_iban: string | null;
  bank_name: string | null;
}

function companyLine(c: CompanySettings): string {
  return [c.name + (c.legal_form && !c.name.endsWith(c.legal_form) ? ` ${c.legal_form}` : ""), [c.street, c.house_number].filter(Boolean).join(" "), [c.postcode, c.city].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" · ");
}

type Brand = ReturnType<typeof brandColors> & { logo: PDFImage | null };

/** The company's accent colour and logo (if one was set). */
async function loadBrand(ctx: Ctx, w: PdfWriter, company: CompanySettings): Promise<Brand> {
  let logo: PDFImage | null = null;
  if (company.logo_file_id && ctx.files) {
    const file = await readFile(ctx, company.logo_file_id).catch(() => null);
    if (file) logo = await embedImage(w.doc, file.bytes, file.row.mime_type);
  }
  return { ...brandColors(company.accent_color), logo };
}

/** Logo box: at most 60 × 14 mm, top-left at (margin, 13 mm). */
export const LOGO_BOX = { top: 13, maxWidth: 60, maxHeight: 14 };

/** Letterhead, sender line and recipient window shared by all letters. */
function letterhead(w: PdfWriter, company: CompanySettings, address: string, brand: Brand) {
  const left = w.margin.left;
  w.rect(0, 0, A4.width, 4, brand.accent);
  if (brand.logo) {
    const scale = Math.min((LOGO_BOX.maxWidth * MM) / brand.logo.width, (LOGO_BOX.maxHeight * MM) / brand.logo.height);
    const width = brand.logo.width * scale;
    const height = brand.logo.height * scale;
    w.page.drawImage(brand.logo, { x: left, y: A4.height - LOGO_BOX.top * MM - height, width, height });
  } else {
    w.text(company.name || "Company", left, 18 * MM, { size: 15, bold: true, color: brand.accent });
  }
  const contact = [
    [company.street, company.house_number].filter(Boolean).join(" "),
    [company.postcode, company.city].filter(Boolean).join(" "),
    company.phone,
    company.email,
    company.website,
  ].filter(Boolean) as string[];
  contact.forEach((line, i) => w.text(line, A4.width - w.margin.right, 18 * MM + i * 10, { size: 8, align: "right", color: COLORS.muted }));

  // Swiss right-window envelope: address field starts ~118 mm from the left, 50 mm from the top.
  const ax = 118 * MM;
  const sender = companyLine(company);
  w.text(sender, ax, 45 * MM, { size: 6.5, color: COLORS.muted });
  w.line(ax, 45 * MM + 8, ax + w.font.widthOfTextAtSize(sender, 6.5), 45 * MM + 8, { color: COLORS.muted, thickness: 0.3 });
  address
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 7)
    .forEach((line, i) => w.text(line, ax, 51 * MM + i * 12, { size: 10 }));
}

function metaTable(w: PdfWriter, rows: [string, string][], y: number) {
  const left = w.margin.left;
  rows.forEach(([label, value], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = left + col * 85 * MM;
    w.text(label, x, y + row * 12, { size: 8, color: COLORS.muted });
    w.text(value, x + 30 * MM, y + row * 12, { size: 8.5 });
  });
  return Math.ceil(rows.length / 2) * 12;
}

function footerLine(company: CompanySettings, bank: BankRow | null): string {
  return [
    companyLine(company),
    company.vat_number ? `UID ${company.vat_number}` : null,
    bank?.iban ? `IBAN ${formatIban(bank.iban)}` : null,
  ]
    .filter(Boolean)
    .join("   |   ");
}

function debtorFromContact(contact: ContactRow | null) {
  if (!contact || !contact.postcode || !contact.city) return null;
  return {
    name: contact.type === "person" ? `${contact.name_2 ?? ""} ${contact.name_1}`.trim() : contact.name_1,
    street: contact.street,
    houseNumber: contact.house_number,
    postcode: contact.postcode,
    town: contact.city,
    country: contact.country_code || "CH",
  };
}

async function qrData(ctx: Ctx, doc: DocumentRow, amountCents: number, company: CompanySettings, contact: ContactRow | null): Promise<QrBillData | null> {
  if (!["CHF", "EUR"].includes(doc.currency_code)) return null;
  const bank = doc.bank_account_id
    ? await ctx.db.first<BankRow>("SELECT iban, qr_iban, bank_name FROM bank_accounts WHERE id = ?", doc.bank_account_id)
    : await ctx.db.first<BankRow>("SELECT iban, qr_iban, bank_name FROM bank_accounts ORDER BY is_default DESC, id LIMIT 1");
  if (!bank || !company.postcode || !company.city) return null;
  const useQrr = !!doc.qr_reference && !!bank.qr_iban;
  const iban = useQrr ? bank.qr_iban! : bank.iban;
  if (!iban || !isValidIban(iban)) return null;
  let reference: string | null = useQrr ? doc.qr_reference : null;
  if (!reference && doc.nr) {
    const body = doc.nr.replace(/[^A-Za-z0-9]/g, "").slice(-21);
    if (body) reference = createScorReference(body);
  }
  return {
    iban,
    creditor: {
      name: company.name,
      street: company.street,
      houseNumber: company.house_number,
      postcode: company.postcode,
      town: company.city,
      country: company.country_code || "CH",
    },
    amount: amountCents > 0 ? fromCents(amountCents) : null,
    currency: doc.currency_code as "CHF" | "EUR",
    debtor: debtorFromContact(contact),
    reference,
    message: `${doc.nr ?? ""}${doc.title ? ` ${doc.title}` : ""}`.trim().slice(0, 140),
  };
}

const TITLE_KEY: Record<string, LabelKey> = {
  quote: "quote",
  order: "order",
  delivery: "delivery",
  invoice: "invoice",
  credit_note: "credit_note",
  purchase_order: "purchase_order",
};

export async function renderDocumentPdf(ctx: Ctx, doc: DocumentRow): Promise<Uint8Array> {
  const lang = doc.language || "de";
  const [company, contact, person] = await Promise.all([
    getSettings(ctx, "company"),
    loadContact(ctx, doc.contact_id),
    loadContact(ctx, doc.contact_person_id),
  ]);
  const bank = await ctx.db.first<BankRow>("SELECT iban, qr_iban, bank_name FROM bank_accounts ORDER BY is_default DESC, id LIMIT 1");
  const titleText = `${t(lang, TITLE_KEY[doc.kind] ?? "invoice")} ${doc.nr ?? ""}`.trim();
  const w = await PdfWriter.create({ title: titleText, author: company.name });
  const left = w.margin.left;
  const right = A4.width - w.margin.right;
  const brand = await loadBrand(ctx, w, company);

  letterhead(w, company, doc.address ?? "", brand);
  w.y = 95 * MM;
  w.text(titleText, left, w.y, { size: 16, bold: true });
  w.y += 24;

  const dueKey: LabelKey = doc.kind === "quote" ? "due_quote" : doc.kind === "invoice" || doc.kind === "credit_note" ? "due_invoice" : "due_delivery";
  const meta: [string, string][] = [[t(lang, "date"), formatDate(doc.date)]];
  if (doc.due_date) meta.push([t(lang, dueKey), formatDate(doc.due_date)]);
  if (contact?.nr) meta.push([t(lang, "customer_no"), contact.nr]);
  if (doc.reference) meta.push([t(lang, "reference"), doc.reference]);
  if (person) meta.push([t(lang, "contact"), `${person.name_2 ?? ""} ${person.name_1}`.trim()]);
  if (company.vat_number) meta.push([t(lang, "vat_no"), company.vat_number]);
  w.y += metaTable(w, meta, w.y) + 12;

  if (doc.title) {
    w.text(doc.title, left, w.y, { size: 10.5, bold: true });
    w.y += 16;
  }
  if (doc.header) {
    w.y += w.paragraph(doc.header, left, w.y, w.contentWidth, { size: 9 }) + 8;
  }

  // ------------------------------------------------------------ positions
  const showPrices = doc.kind !== "delivery";
  const col = {
    pos: left,
    desc: left + 10 * MM,
    qty: right - (showPrices ? 76 : 18) * MM,
    unit: right - (showPrices ? 74 : 16) * MM,
    price: right - 38 * MM,
    disc: right - 26 * MM,
    total: right,
  };
  const descWidth = (showPrices ? col.qty - 14 * MM : col.qty - 16 * MM) - col.desc;
  const anyDiscount = doc.positions.some((p) => (p.type === "item" || p.type === "custom") && p.discount_percent);

  const tableHeader = () => {
    w.rect(left - 2, w.y - 3, w.contentWidth + 4, 16, brand.accentLight);
    w.text(t(lang, "pos"), col.pos, w.y, { size: 7.5, bold: true, color: brand.accent });
    w.text(t(lang, "description"), col.desc, w.y, { size: 7.5, bold: true, color: brand.accent });
    w.text(t(lang, "qty"), col.qty, w.y, { size: 7.5, bold: true, color: brand.accent, align: "right" });
    w.text(t(lang, "unit"), col.unit, w.y, { size: 7.5, bold: true, color: brand.accent });
    if (showPrices) {
      w.text(t(lang, "price"), col.price, w.y, { size: 7.5, bold: true, color: brand.accent, align: "right" });
      if (anyDiscount) w.text(t(lang, "discount"), col.disc, w.y, { size: 7.5, bold: true, color: brand.accent, align: "right" });
      w.text(t(lang, "total"), col.total, w.y, { size: 7.5, bold: true, color: brand.accent, align: "right" });
    }
    w.y += 18;
  };
  w.onNewPage = (writer) => {
    writer.y = writer.margin.top + 6;
    writer.text(titleText, writer.margin.left, writer.y, { size: 9, bold: true, color: COLORS.muted });
    writer.y += 20;
    tableHeader();
  };
  tableHeader();

  const calc = calculateDocument(doc.positions, doc.vat_mode, await roundingStep(ctx, doc.currency_code));
  let posNr = 0;
  doc.positions.forEach((p, i) => {
    const line = calc.lines[i];
    if (p.type === "pagebreak") {
      w.addPage();
      return;
    }
    if (p.type === "text") {
      const h = w.measure(p.text ?? "", w.contentWidth - 10 * MM, 9, true);
      w.ensure(h + 6);
      w.y += w.paragraph(p.text ?? "", col.desc, w.y, w.contentWidth - 10 * MM, { size: 9, bold: true }) + 6;
      return;
    }
    if (p.type === "subtotal") {
      if (!showPrices) return;
      w.ensure(18);
      w.line(col.price - 20 * MM, w.y - 3, right, w.y - 3, { color: COLORS.text, thickness: 0.6 });
      w.text(t(lang, "subtotal"), col.desc, w.y, { size: 9, bold: true });
      w.text(formatAmount(line?.subtotal ?? 0), col.total, w.y, { size: 9, bold: true, align: "right" });
      w.y += 16;
      return;
    }
    if (p.type === "discount") {
      if (!showPrices) return;
      w.ensure(14);
      const label = `${p.text || t(lang, "discount")}${p.discount_percent ? ` ${formatDecimal(p.discount_percent, 2)}%` : ""}`;
      w.text(label, col.desc, w.y, { size: 9 });
      w.text(formatAmount(line?.total ?? 0), col.total, w.y, { size: 9, align: "right" });
      w.y += 14;
      return;
    }
    posNr++;
    const text = `${p.code ? `${p.code} ` : ""}${p.text ?? ""}`;
    const h = Math.max(12, w.measure(text, descWidth, 9));
    w.ensure(h + 4);
    const y = w.y;
    w.text(String(posNr), col.pos, y, { size: 9, color: COLORS.muted });
    w.paragraph(text, col.desc, y, descWidth, { size: 9, color: p.is_optional ? COLORS.muted : COLORS.text });
    w.text(formatDecimal(p.quantity, 3), col.qty, y, { size: 9, align: "right" });
    if (p.unit_name) w.text(p.unit_name, col.unit, y, { size: 9 });
    if (showPrices) {
      w.text(formatDecimal(p.unit_price, 4, 2), col.price, y, { size: 9, align: "right" });
      if (p.discount_percent) w.text(`${formatDecimal(p.discount_percent, 2)}%`, col.disc, y, { size: 9, align: "right" });
      w.text(p.is_optional ? `(${formatAmount(line?.total ?? 0)})` : formatAmount(line?.total ?? 0), col.total, y, {
        size: 9,
        align: "right",
        color: p.is_optional ? COLORS.muted : COLORS.text,
      });
    }
    if (p.is_optional) w.text(t(lang, "optional"), col.desc, y + h - 2, { size: 7, color: COLORS.muted });
    w.y += h + 4 + (p.is_optional ? 8 : 0);
    w.line(left, w.y - 3, right, w.y - 3, { color: COLORS.line, thickness: 0.3 });
  });

  // --------------------------------------------------------------- totals
  if (showPrices) {
    const rows: [string, number, boolean?][] = [];
    const vatLines = calc.vat.filter((b) => b.rate > 0 && doc.vat_mode !== "none");
    if (doc.vat_mode === "excl") {
      rows.push([t(lang, "net_total"), calc.totalNet]);
      for (const b of vatLines) rows.push([`${t(lang, "vat_on", { rate: formatDecimal(b.rate, 1) })} ${formatAmount(b.base)}`, b.vat]);
    }
    if (calc.rounding) rows.push([t(lang, "rounding"), calc.rounding]);
    w.ensure(rows.length * 13 + 40);
    w.y += 6;
    const labelX = right - 90 * MM;
    for (const [label, amount] of rows) {
      w.text(label, labelX, w.y, { size: 9, color: COLORS.muted });
      w.text(formatAmount(amount), right, w.y, { size: 9, align: "right" });
      w.y += 13;
    }
    w.rect(labelX - 4, w.y - 4, right - labelX + 6, 20, brand.accent);
    w.text(`${t(lang, "total_amount")} ${doc.currency_code}`, labelX, w.y + 1, { size: 10, bold: true, color: COLORS.white });
    w.text(formatAmount(calc.total), right, w.y + 1, { size: 10, bold: true, color: COLORS.white, align: "right" });
    w.y += 22;
    if (doc.vat_mode === "incl") {
      for (const b of vatLines) {
        w.text(`${t(lang, "vat_incl", { rate: formatDecimal(b.rate, 1) })}: ${formatAmount(b.vat)}`, right, w.y, { size: 7.5, color: COLORS.muted, align: "right" });
        w.y += 10;
      }
    }
    if ((doc.kind === "invoice" || doc.kind === "credit_note") && doc.amount_paid > 0) {
      w.text(t(lang, "paid"), labelX, w.y, { size: 9, color: COLORS.muted });
      w.text(`- ${formatAmount(doc.amount_paid)}`, right, w.y, { size: 9, align: "right" });
      w.y += 13;
      w.text(t(lang, "open_amount"), labelX, w.y, { size: 9.5, bold: true });
      w.text(formatAmount(doc.amount_open), right, w.y, { size: 9.5, bold: true, align: "right" });
      w.y += 16;
    }
  }

  if (doc.footer) {
    w.y += 10;
    const h = w.measure(doc.footer, w.contentWidth);
    w.ensure(h);
    w.y += w.paragraph(doc.footer, left, w.y, w.contentWidth, { size: 9 });
  }

  // -------------------------------------------------------------- QR-bill
  if (doc.kind === "invoice" && !["cancelled", "paid", "written_off"].includes(doc.status)) {
    const amount = doc.status === "draft" ? calc.total : doc.amount_open;
    const data = await qrData(ctx, doc, amount, company, contact);
    if (data) {
      w.onNewPage = undefined;
      if (w.y > A4.height - QR_SLIP_HEIGHT - 8 * MM) w.addPage();
      drawQrBill(w, data, lang);
    }
  }

  w.finalizeFooters(footerLine(company, bank), t(lang, "page"));
  return w.save();
}

export interface ReminderRow {
  id: number;
  document_id: number;
  level: number;
  date: string;
  due_date: string;
  fee: number;
  title: string | null;
  header: string | null;
  footer: string | null;
}

export async function renderReminderPdf(ctx: Ctx, reminder: ReminderRow, doc: DocumentRow): Promise<Uint8Array> {
  const lang = doc.language || "de";
  const [company, contact] = await Promise.all([getSettings(ctx, "company"), loadContact(ctx, doc.contact_id)]);
  const bank = await ctx.db.first<BankRow>("SELECT iban, qr_iban, bank_name FROM bank_accounts ORDER BY is_default DESC, id LIMIT 1");
  const title = reminder.title ?? `${t(lang, "reminder")} ${doc.nr ?? ""}`;
  const w = await PdfWriter.create({ title, author: company.name });
  const left = w.margin.left;
  const right = A4.width - w.margin.right;
  letterhead(w, company, doc.address ?? "", await loadBrand(ctx, w, company));
  w.y = 95 * MM;
  w.text(title, left, w.y, { size: 15, bold: true });
  w.y += 24;
  w.y +=
    metaTable(
      w,
      [
        [t(lang, "date"), formatDate(reminder.date)],
        [t(lang, "due_invoice"), formatDate(reminder.due_date)],
        [t(lang, "invoice"), doc.nr ?? `#${doc.id}`],
        [t(lang, "original_due"), formatDate(doc.due_date)],
      ],
      w.y,
    ) + 14;
  if (reminder.header) w.y += w.paragraph(reminder.header, left, w.y, w.contentWidth, { size: 9.5 }) + 14;

  const due = doc.amount_open + reminder.fee;
  const rows: [string, number, boolean][] = [
    [`${t(lang, "invoice_amount")} ${doc.nr ?? ""} (${formatDate(doc.date)})`, doc.total, false],
    [t(lang, "paid"), -doc.amount_paid, false],
    [t(lang, "fee"), reminder.fee, false],
    [`${t(lang, "open_amount")} ${doc.currency_code}`, due, true],
  ];
  for (const [label, amount, strong] of rows) {
    if (!amount && !strong) continue;
    if (strong) w.line(left, w.y - 3, right, w.y - 3, { color: COLORS.text, thickness: 0.6 });
    w.text(label, left, w.y, { size: 9.5, bold: strong });
    w.text(formatAmount(amount), right, w.y, { size: 9.5, bold: strong, align: "right" });
    w.y += 15;
  }
  if (reminder.footer) w.y += 10 + w.paragraph(reminder.footer, left, w.y + 10, w.contentWidth, { size: 9 });

  const data = await qrData(ctx, { ...doc }, due, company, contact);
  if (data) {
    if (w.y > A4.height - QR_SLIP_HEIGHT - 8 * MM) w.addPage();
    drawQrBill(w, data, lang);
  }
  w.finalizeFooters(footerLine(company, bank), t(lang, "page"));
  return w.save();
}
