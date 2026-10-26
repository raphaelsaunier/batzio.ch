import { describe, expect, it } from "vitest";
import { bestMatch, categorize } from "../src/quick/autopilot";
import { extractAmount, extractDate, parseLine, parseQuick } from "@batzio/core/quick/parse";

const TODAY = "2026-10-25"; // a Sunday

describe("dates", () => {
  it("understands relative and Swiss dates", () => {
    expect(extractDate("yesterday", TODAY).date).toBe("2026-10-24");
    expect(extractDate("gestern", TODAY).date).toBe("2026-10-24");
    expect(extractDate("3 days ago", TODAY).date).toBe("2026-10-22");
    expect(extractDate("on 12.10.", TODAY).date).toBe("2026-10-12");
    expect(extractDate("am 3.9.25", TODAY).date).toBe("2025-09-03");
    expect(extractDate("last friday", TODAY).date).toBe("2026-10-23");
    expect(extractDate("next monday", TODAY).date).toBe("2026-10-26");
  });
});

describe("amounts and lines", () => {
  it("reads Swiss amounts", () => {
    expect(extractAmount("CHF 1'234.50 for rent").amount).toBe(1234.5);
    expect(extractAmount("49,90 Fr. coffee").amount).toBe(49.9);
    expect(extractAmount("12.– parking").amount).toBe(12);
    expect(extractAmount("3h on stuff").amount).toBeNull();
  });
  it("reads invoice lines", () => {
    expect(parseLine("12h development at 160")).toEqual({ quantity: 12, unit: "h", description: "development", price: 160 });
    expect(parseLine("2x workshop")).toEqual({ quantity: 2, unit: null, description: "workshop", price: null });
    expect(parseLine("hosting 49")).toEqual({ quantity: 1, unit: null, description: "hosting", price: 49 });
    expect(parseLine("consulting 4h @ 180")).toEqual({ quantity: 4, unit: "h", description: "consulting", price: 180 });
  });
});

describe("intents", () => {
  it("parses invoices and quotes", () => {
    const p = parseQuick("invoice Rhein Logistik 12h development at 160, hosting 49", TODAY)!;
    expect(p.intent).toBe("invoice");
    expect(p.who).toBe("Rhein Logistik");
    expect(p.lines).toHaveLength(2);
    expect(p.lines[1]).toMatchObject({ description: "hosting", price: 49 });
    const q = parseQuick("quote 2x workshop for Bergsicht", TODAY)!;
    expect(q).toMatchObject({ intent: "quote", who: "Bergsicht" });
    expect(parseQuick("rechnung Morel: 3h consulting", TODAY)).toMatchObject({ intent: "invoice", who: "Morel" });
  });
  it("parses expenses", () => {
    expect(parseQuick("paid 49.90 for Swisscom internet yesterday", TODAY)).toMatchObject({ intent: "expense", amount: 49.9, text: "Swisscom internet", date: "2026-10-24" });
    expect(parseQuick("spent CHF 128 on train tickets", TODAY)).toMatchObject({ intent: "expense", amount: 128, text: "train tickets" });
  });
  it("parses time", () => {
    expect(parseQuick("3.5h on Website relaunch: wireframes", TODAY)).toMatchObject({ intent: "time", minutes: 210, who: "Website relaunch", text: "wireframes" });
    expect(parseQuick("worked 2h 30m for Bergsicht yesterday", TODAY)).toMatchObject({ intent: "time", minutes: 150, who: "Bergsicht", date: "2026-10-24" });
    expect(parseQuick("90 min support for Rhein", TODAY)).toMatchObject({ intent: "time", minutes: 90 });
  });
  it("parses payments, bills, contacts and tasks", () => {
    expect(parseQuick("Rhein Logistik paid 1636.10", TODAY)).toMatchObject({ intent: "payment", who: "Rhein Logistik", amount: 1636.1 });
    expect(parseQuick("bill from Swisscloud 486.50 due in 20 days", TODAY)).toMatchObject({ intent: "bill", who: "Swisscloud", amount: 486.5, dueInDays: 20 });
    expect(parseQuick("new customer Muster AG, Bahnhofstrasse 1, 8001 Zürich, info@muster.ch", TODAY)).toMatchObject({
      intent: "contact",
      who: "Muster AG",
      street: "Bahnhofstrasse",
      houseNumber: "1",
      postcode: "8001",
      city: "Zürich",
      email: "info@muster.ch",
      text: "customer",
    });
    expect(parseQuick("remind me to call Anna on friday", TODAY)).toMatchObject({ intent: "task", text: "call Anna", date: "2026-10-23" });
  });
  it("ignores small talk", () => {
    expect(parseQuick("hello there", TODAY)).toBeNull();
  });
});

describe("autopilot", () => {
  it("categorises spending", () => {
    expect(categorize("SBB ticket Zürich–Bern").accountNumber).toBe("6200");
    expect(categorize("Swisscom internet").accountNumber).toBe("6510");
    expect(categorize("Account maintenance fee").accountNumber).toBe("6940");
    expect(categorize("lunch with client").accountNumber).toBe("6700");
    expect(categorize("something odd").label).toBe("Other expenses");
  });
  it("fuzzy matches names", () => {
    const names = ["Rhein Logistik AG", "Bergsicht Hotels AG", "Kaffeerösterei Lindenhof GmbH"];
    expect(bestMatch("rhein", names, (n) => n)).toBe("Rhein Logistik AG");
    expect(bestMatch("lindenhof", names, (n) => n)).toBe("Kaffeerösterei Lindenhof GmbH");
    expect(bestMatch("kaffeeroesterei", names, (n) => n)).toBeNull();
    expect(bestMatch("Kaffeerösterei", names, (n) => n)).toBe("Kaffeerösterei Lindenhof GmbH");
  });
});
