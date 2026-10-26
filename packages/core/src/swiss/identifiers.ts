/** Swiss enterprise (UID) and social security (AHV/AVS) number helpers. */

const UID_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4];

/** Validates "CHE-123.456.788" (optionally followed by "MWST"/"TVA"/"IVA"). */
export function isValidUid(value: string | null | undefined): boolean {
  const digits = (value ?? "").toUpperCase().replace(/\s*(MWST|TVA|IVA|HR|RC|RI)\s*$/, "").replace(/[^0-9]/g, "");
  if (!/^CHE/i.test((value ?? "").trim()) || digits.length !== 9) return false;
  const sum = UID_WEIGHTS.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  let check = 11 - (sum % 11);
  if (check === 11) check = 0;
  if (check === 10) return false;
  return check === Number(digits[8]);
}

export function formatUid(value: string): string {
  const d = value.replace(/\D/g, "");
  if (d.length !== 9) return value;
  return `CHE-${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
}

/** Validates a 13-digit AHV number "756.1234.5678.97" (EAN-13 check digit). */
export function isValidAhvNumber(value: string | null | undefined): boolean {
  const d = (value ?? "").replace(/\D/g, "");
  if (d.length !== 13 || !d.startsWith("756")) return false;
  const sum = d
    .slice(0, 12)
    .split("")
    .reduce((acc, c, i) => acc + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(d[12]);
}

export function formatAhvNumber(value: string): string {
  const d = value.replace(/\D/g, "");
  if (d.length !== 13) return value;
  return `${d.slice(0, 3)}.${d.slice(3, 7)}.${d.slice(7, 11)}.${d.slice(11)}`;
}
