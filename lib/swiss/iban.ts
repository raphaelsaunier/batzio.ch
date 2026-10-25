/** IBAN helpers with special handling for Swiss / Liechtenstein QR-IBANs. */

export function normalizeIban(iban: string | null | undefined): string {
  return (iban ?? "").replace(/\s+/g, "").toUpperCase();
}

/** Converts letters to digits (A=10 … Z=35) as used by ISO 7064 MOD 97-10. */
export function alphaToDigits(value: string): string {
  return value
    .toUpperCase()
    .split("")
    .map((c) => (c >= "A" && c <= "Z" ? String(c.charCodeAt(0) - 55) : c))
    .join("");
}

/** Computes `digits mod 97` on an arbitrarily long digit string. */
export function mod97(digits: string): number {
  let remainder = 0;
  for (let i = 0; i < digits.length; i += 7) {
    remainder = Number(String(remainder) + digits.slice(i, i + 7)) % 97;
  }
  return remainder;
}

export function isValidIban(iban: string | null | undefined): boolean {
  const v = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(v)) return false;
  if ((v.startsWith("CH") || v.startsWith("LI")) && v.length !== 21) return false;
  return mod97(alphaToDigits(v.slice(4) + v.slice(0, 4))) === 1;
}

/** QR-IBANs carry an institution id (IID) between 30000 and 31999. */
export function isQrIban(iban: string | null | undefined): boolean {
  const v = normalizeIban(iban);
  if (!isValidIban(v) || !(v.startsWith("CH") || v.startsWith("LI"))) return false;
  const iid = Number(v.slice(4, 9));
  return iid >= 30000 && iid <= 31999;
}

/** "CH4431999123000889012" → "CH44 3199 9123 0008 8901 2" */
export function formatIban(iban: string | null | undefined): string {
  return normalizeIban(iban).replace(/(.{4})/g, "$1 ").trim();
}
