import { isQrIban, isValidIban, normalizeIban } from "./iban";
import { isValidQrReference, isValidScorReference } from "./references";

/** Structured address (address type "S"), the only type allowed since Nov 2025. */
export interface QrAddress {
  name: string;
  street?: string | null;
  houseNumber?: string | null;
  postcode: string;
  town: string;
  country: string;
}

export interface QrBillData {
  iban: string;
  creditor: QrAddress;
  /** Amount in major units; omit for an open amount. */
  amount?: number | null;
  currency: "CHF" | "EUR";
  debtor?: QrAddress | null;
  reference?: string | null;
  message?: string | null;
  billInformation?: string | null;
}

export type QrReferenceType = "QRR" | "SCOR" | "NON";

const clip = (v: string | null | undefined, max: number) =>
  (v ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, max);

export function referenceType(data: Pick<QrBillData, "iban" | "reference">): QrReferenceType {
  const ref = (data.reference ?? "").replace(/\s+/g, "");
  if (!ref) return "NON";
  return ref.toUpperCase().startsWith("RF") ? "SCOR" : "QRR";
}

/** Validates the business rules of the Swiss Payments Code. Returns error messages. */
export function validateQrBill(data: QrBillData): string[] {
  const errors: string[] = [];
  const iban = normalizeIban(data.iban);
  if (!isValidIban(iban)) errors.push("Invalid IBAN");
  else if (!iban.startsWith("CH") && !iban.startsWith("LI")) errors.push("QR-bill IBAN must be Swiss or Liechtenstein");

  const type = referenceType(data);
  const ref = (data.reference ?? "").replace(/\s+/g, "");
  if (isQrIban(iban) && type !== "QRR") errors.push("A QR-IBAN requires a QR reference");
  if (!isQrIban(iban) && type === "QRR") errors.push("A QR reference requires a QR-IBAN");
  if (type === "QRR" && !isValidQrReference(ref)) errors.push("Invalid QR reference");
  if (type === "SCOR" && !isValidScorReference(ref)) errors.push("Invalid creditor reference");

  if (data.amount !== null && data.amount !== undefined) {
    if (data.amount < 0.01 || data.amount > 999_999_999.99) errors.push("Amount out of range");
  }
  for (const [label, addr] of [
    ["Creditor", data.creditor],
    ["Debtor", data.debtor],
  ] as const) {
    if (!addr) continue;
    if (!addr.name) errors.push(`${label} name is required`);
    if (!addr.postcode || !addr.town) errors.push(`${label} postcode and town are required`);
    if (!/^[A-Z]{2}$/.test(addr.country)) errors.push(`${label} country must be an ISO code`);
  }
  if ((data.message ?? "").length + (data.billInformation ?? "").length > 140) {
    errors.push("Message and bill information must not exceed 140 characters");
  }
  return errors;
}

function addressLines(addr: QrAddress | null | undefined): string[] {
  if (!addr) return ["", "", "", "", "", "", ""];
  return [
    "S",
    clip(addr.name, 70),
    clip(addr.street, 70),
    clip(addr.houseNumber, 16),
    clip(addr.postcode, 16),
    clip(addr.town, 35),
    clip(addr.country, 2).toUpperCase(),
  ];
}

/** Builds the payload encoded in the Swiss QR Code (version 2.0, UTF-8). */
export function buildQrPayload(data: QrBillData): string {
  const type = referenceType(data);
  const lines = [
    "SPC",
    "0200",
    "1",
    normalizeIban(data.iban),
    ...addressLines(data.creditor),
    // Ultimate creditor: reserved for future use, must be empty.
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    data.amount === null || data.amount === undefined ? "" : data.amount.toFixed(2),
    data.currency,
    ...addressLines(data.debtor),
    type,
    type === "NON" ? "" : (data.reference ?? "").replace(/\s+/g, "").toUpperCase(),
    clip(data.message, 140),
    "EPD",
  ];
  if (data.billInformation) lines.push(clip(data.billInformation, 140));
  return lines.join("\n");
}
