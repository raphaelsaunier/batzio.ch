import qrcode from "qrcode-generator";
import { rgb } from "pdf-lib";
import { formatIban } from "@/lib/swiss/iban";
import { buildQrPayload, referenceType, type QrAddress, type QrBillData } from "@/lib/swiss/qr-bill";
import { formatQrReference, formatScorReference } from "@/lib/swiss/references";
import { A4, MM, type PdfWriter } from "./base";
import { t } from "./i18n";

export const QR_SLIP_HEIGHT = 105 * MM;

const black = rgb(0, 0, 0);

function utf8Binary(value: string): string {
  return Array.from(new TextEncoder().encode(value), (b) => String.fromCharCode(b)).join("");
}

function addressLines(a: QrAddress | null | undefined): string[] {
  if (!a) return [];
  const street = [a.street, a.houseNumber].filter(Boolean).join(" ");
  return [a.name, street, `${a.country !== "CH" ? `${a.country}-` : ""}${a.postcode} ${a.town}`].filter(Boolean) as string[];
}

/** "1949.75" → "1 949.75" as required by the QR-bill style guide. */
function slipAmount(amount: number): string {
  const [int, dec] = amount.toFixed(2).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}.${dec}`;
}

function formattedReference(data: QrBillData): string | null {
  const type = referenceType(data);
  if (type === "NON" || !data.reference) return null;
  return type === "QRR" ? formatQrReference(data.reference) : formatScorReference(data.reference);
}

/** Corner marks for empty fields (to be filled in by hand). */
function cornerBox(w: PdfWriter, x: number, y: number, width: number, height: number) {
  const l = 3 * MM;
  const opts = { color: black, thickness: 0.75 };
  w.line(x, y, x + l, y, opts);
  w.line(x, y, x, y + l, opts);
  w.line(x + width - l, y, x + width, y, opts);
  w.line(x + width, y, x + width, y + l, opts);
  w.line(x, y + height - l, x, y + height, opts);
  w.line(x, y + height, x + l, y + height, opts);
  w.line(x + width, y + height - l, x + width, y + height, opts);
  w.line(x + width - l, y + height, x + width, y + height, opts);
}

/**
 * Draws the Swiss QR-bill (receipt + payment part) on the bottom 105 mm of the
 * current page, following the SIX style guide (fonts 6–11 pt, 46 mm QR code).
 */
export function drawQrBill(w: PdfWriter, data: QrBillData, lang: string) {
  w.noFooter.add(w.page);
  const top = A4.height - QR_SLIP_HEIGHT;
  const X = (mm: number) => mm * MM;
  const Y = (mm: number) => top + mm * MM;

  // Separation lines (perforation).
  w.line(0, top, A4.width, top, { color: black, thickness: 0.5, dash: [3, 2] });
  w.line(X(62), top, X(62), A4.height, { color: black, thickness: 0.5, dash: [3, 2] });
  w.text(t(lang, "qr_separate"), A4.width / 2, top - 3 * MM, { size: 6, align: "center", color: rgb(0.3, 0.3, 0.3) });

  const ref = formattedReference(data);
  const creditor = [formatIban(data.iban), ...addressLines(data.creditor)];
  const debtor = addressLines(data.debtor);

  // ------------------------------------------------------------- receipt
  w.text(t(lang, "qr_receipt"), X(5), Y(5), { size: 11, bold: true, color: black });
  let y = Y(12);
  const recHead = (label: string) => {
    w.text(label, X(5), y, { size: 6, bold: true, color: black });
    y += 9;
  };
  const recLine = (value: string) => {
    w.text(value, X(5), y, { size: 8, color: black });
    y += 9;
  };
  recHead(t(lang, "qr_account"));
  creditor.forEach(recLine);
  y += 9;
  if (ref) {
    recHead(t(lang, "qr_reference"));
    recLine(ref);
    y += 9;
  }
  if (debtor.length) {
    recHead(t(lang, "qr_payable_by"));
    debtor.forEach(recLine);
  } else {
    recHead(t(lang, "qr_payable_by_blank"));
    cornerBox(w, X(5), y, X(52), X(20));
  }
  w.text(t(lang, "qr_currency"), X(5), Y(68), { size: 6, bold: true, color: black });
  w.text(t(lang, "qr_amount"), X(22), Y(68), { size: 6, bold: true, color: black });
  w.text(data.currency, X(5), Y(68) + 9, { size: 8, color: black });
  if (data.amount) w.text(slipAmount(data.amount), X(22), Y(68) + 9, { size: 8, color: black });
  else cornerBox(w, X(27), Y(68) + 2, X(30), X(10));
  w.text(t(lang, "qr_acceptance"), X(57), Y(82), { size: 6, bold: true, color: black, align: "right" });

  // -------------------------------------------------------- payment part
  w.text(t(lang, "qr_payment_part"), X(67), Y(5), { size: 11, bold: true, color: black });

  const qr = qrcode(0, "M");
  qr.addData(utf8Binary(buildQrPayload(data)), "Byte");
  qr.make();
  const count = qr.getModuleCount();
  const size = 46 * MM;
  const cell = size / count;
  const qx = X(67);
  const qy = Y(17);
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        w.page.drawRectangle({ x: qx + c * cell, y: A4.height - (qy + (r + 1) * cell), width: cell + 0.05, height: cell + 0.05, color: black });
      }
    }
  }
  // Swiss cross in the centre (7 x 7 mm incl. white border).
  const cx = qx + size / 2;
  const cy = qy + size / 2;
  const box = (x: number, yy: number, wd: number, ht: number, color: ReturnType<typeof rgb>) =>
    w.page.drawRectangle({ x: x - wd / 2, y: A4.height - yy - ht / 2, width: wd, height: ht, color });
  box(cx, cy, 7 * MM, 7 * MM, rgb(1, 1, 1));
  box(cx, cy, 6 * MM, 6 * MM, black);
  box(cx, cy, 1.17 * MM, 3.89 * MM, rgb(1, 1, 1));
  box(cx, cy, 3.89 * MM, 1.17 * MM, rgb(1, 1, 1));

  w.text(t(lang, "qr_currency"), X(67), Y(68), { size: 8, bold: true, color: black });
  w.text(t(lang, "qr_amount"), X(87), Y(68), { size: 8, bold: true, color: black });
  w.text(data.currency, X(67), Y(68) + 11, { size: 10, color: black });
  if (data.amount) w.text(slipAmount(data.amount), X(87), Y(68) + 11, { size: 10, color: black });
  else cornerBox(w, X(78), Y(68) + 4, X(40), X(15));

  y = Y(5);
  const head = (label: string) => {
    w.text(label, X(118), y, { size: 8, bold: true, color: black });
    y += 11;
  };
  const line = (value: string) => {
    w.text(value, X(118), y, { size: 10, color: black });
    y += 11;
  };
  head(t(lang, "qr_account"));
  creditor.forEach(line);
  y += 6;
  if (ref) {
    head(t(lang, "qr_reference"));
    line(ref);
    y += 6;
  }
  const info = [data.message, data.billInformation].filter(Boolean).join(" ");
  if (info) {
    head(t(lang, "qr_additional"));
    y += w.paragraph(info, X(118), y, X(87), { size: 10, color: black, lineHeight: 11 });
    y += 6;
  }
  if (debtor.length) {
    head(t(lang, "qr_payable_by"));
    debtor.forEach(line);
  } else {
    head(t(lang, "qr_payable_by_blank"));
    cornerBox(w, X(118), y, X(65), X(25));
  }
}
