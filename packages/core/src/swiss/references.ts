import { alphaToDigits, mod97 } from "./iban";

const MOD10_TABLE = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];

/** Recursive modulo 10 check digit used by QR references (QRR). */
export function mod10Recursive(digits: string): number {
  let carry = 0;
  for (const ch of digits) carry = MOD10_TABLE[(carry + Number(ch)) % 10];
  return (10 - carry) % 10;
}

/**
 * Builds a 27-digit QR reference from an optional customer prefix (bank-issued
 * participant number) and a document number. Non-digits are stripped.
 */
export function createQrReference(documentNumber: string | number, prefix = ""): string {
  const body = `${prefix.replace(/\D/g, "")}${String(documentNumber).replace(/\D/g, "")}`;
  if (body.length > 26) throw new Error("QR reference body exceeds 26 digits");
  const padded = body.padStart(26, "0");
  return `${padded}${mod10Recursive(padded)}`;
}

export function isValidQrReference(ref: string | null | undefined): boolean {
  const v = (ref ?? "").replace(/\s+/g, "");
  if (!/^\d{27}$/.test(v)) return false;
  return mod10Recursive(v.slice(0, 26)) === Number(v[26]);
}

/** "210000000003139471430009017" → "21 00000 00003 13947 14300 09017" */
export function formatQrReference(ref: string): string {
  const v = ref.replace(/\s+/g, "");
  return `${v.slice(0, 2)} ${v.slice(2).replace(/(.{5})/g, "$1 ")}`.trim();
}

/** ISO 11649 structured creditor reference ("RF" reference). */
export function createScorReference(reference: string | number): string {
  const body = String(reference).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!body || body.length > 21) throw new Error("Creditor reference must be 1–21 alphanumeric characters");
  const check = 98 - mod97(alphaToDigits(`${body}RF00`));
  return `RF${String(check).padStart(2, "0")}${body}`;
}

export function isValidScorReference(ref: string | null | undefined): boolean {
  const v = (ref ?? "").replace(/\s+/g, "").toUpperCase();
  if (!/^RF\d{2}[A-Z0-9]{1,21}$/.test(v)) return false;
  return mod97(alphaToDigits(v.slice(4) + v.slice(0, 4))) === 1;
}

export function formatScorReference(ref: string): string {
  return ref.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}
