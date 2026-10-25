import { describe, expect, it } from "vitest";
import { isQrIban, isValidIban } from "@/lib/swiss/iban";
import { isValidAhvNumber, isValidUid } from "@/lib/swiss/identifiers";
import { buildQrPayload, validateQrBill } from "@/lib/swiss/qr-bill";
import { createQrReference, createScorReference, isValidQrReference, isValidScorReference } from "@/lib/swiss/references";

describe("IBAN", () => {
  it("validates Swiss IBANs and detects QR-IBANs", () => {
    expect(isValidIban("CH93 0076 2011 6238 5295 7")).toBe(true);
    expect(isValidIban("CH93 0076 2011 6238 5295 8")).toBe(false);
    expect(isValidIban("CH5604835012345678009")).toBe(true);
    expect(isQrIban("CH44 3199 9123 0008 8901 2")).toBe(true);
    expect(isQrIban("CH9300762011623852957")).toBe(false);
  });
});

describe("references", () => {
  it("creates QR references with a recursive mod-10 check digit", () => {
    expect(isValidQrReference("210000000003139471430009017")).toBe(true);
    const ref = createQrReference("1000000042");
    expect(ref).toHaveLength(27);
    expect(isValidQrReference(ref)).toBe(true);
  });
  it("creates ISO 11649 creditor references", () => {
    expect(isValidScorReference("RF18 5390 0754 7034")).toBe(true);
    const ref = createScorReference("INV20260001");
    expect(isValidScorReference(ref)).toBe(true);
  });
});

describe("identifiers", () => {
  it("validates UID and AHV numbers", () => {
    expect(isValidUid("CHE-123.456.788 MWST")).toBe(true);
    expect(isValidUid("CHE-123.456.789")).toBe(false);
    expect(isValidAhvNumber("756.9217.0769.85")).toBe(true);
    expect(isValidAhvNumber("756.9217.0769.84")).toBe(false);
  });
});

describe("QR-bill payload", () => {
  const data = {
    iban: "CH4431999123000889012",
    creditor: { name: "Robert Schneider AG", street: "Rue du Lac", houseNumber: "1268", postcode: "2501", town: "Biel", country: "CH" },
    amount: 1949.75,
    currency: "CHF" as const,
    debtor: { name: "Pia-Maria Rutschmann-Schnyder", street: "Grosse Marktgasse", houseNumber: "28", postcode: "9400", town: "Rorschach", country: "CH" },
    reference: "210000000003139471430009017",
    message: "Order of 15 June 2026",
  };
  it("follows the SPC 0200 layout", () => {
    const lines = buildQrPayload(data).split("\n");
    expect(lines.slice(0, 4)).toEqual(["SPC", "0200", "1", "CH4431999123000889012"]);
    expect(lines[4]).toBe("S");
    expect(lines[18]).toBe("1949.75");
    expect(lines[19]).toBe("CHF");
    expect(lines[27]).toBe("QRR");
    expect(lines[30]).toBe("EPD");
    expect(validateQrBill(data)).toEqual([]);
  });
  it("rejects a QR reference on a normal IBAN", () => {
    expect(validateQrBill({ ...data, iban: "CH9300762011623852957" })).toContain("A QR reference requires a QR-IBAN");
  });
});

describe("chart of accounts", async () => {
  const { groupFor, parentGroupFor } = await import("@/lib/swiss/chart-of-accounts");
  it("maps accounts to KMU groups by range", () => {
    expect(groupFor("1020")).toBe("100");
    expect(groupFor("1100")).toBe("110");
    expect(groupFor("1170")).toBe("114");
    expect(groupFor("1520")).toBe("150");
    expect(groupFor("2270")).toBe("220");
    expect(groupFor("2800")).toBe("28");
    expect(groupFor("2970")).toBe("28");
    expect(groupFor("3400")).toBe("3");
    expect(parentGroupFor("114")).toBe("10");
    expect(parentGroupFor("150")).toBe("14");
    expect(parentGroupFor("28")).toBe("2");
  });
});
