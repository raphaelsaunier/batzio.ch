import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { normalize } from "../quick/autopilot";

/**
 * Reads spreadsheets people drop on Batzio (CSV or XLSX exports from other
 * tools, banks or a fiduciary) and figures out what they contain.
 */

export type Cell = string | number | null;
export interface Table {
  sheet: string;
  headers: string[];
  rows: Cell[][];
}

// ------------------------------------------------------------------ CSV

export function parseCsv(text: string): Table {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const counts = [";", ",", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  const [headers = [], ...body] = rows;
  return { sheet: "CSV", headers: headers.map((h) => h.trim()), rows: body.map((r) => r.map((v) => (v.trim() === "" ? null : v.trim()))) };
}

// ----------------------------------------------------------------- XLSX

const COL = (ref: string) => {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const textOf = (node: unknown): string => {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  const n = node as Record<string, unknown>;
  if ("#text" in n) return String(n["#text"]);
  if ("t" in n) return textOf(n.t);
  if ("r" in n) return (Array.isArray(n.r) ? n.r : [n.r]).map(textOf).join("");
  return "";
};

/** Reads every sheet of an .xlsx workbook into tables (first row = headers). */
export function parseXlsx(bytes: Uint8Array): Table[] {
  const files = unzipSync(bytes);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    parseTagValue: false,
    isArray: (name) => ["sheet", "row", "c", "si", "r", "Relationship"].includes(name),
  });
  const read = (path: string) => (files[path] ? parser.parse(strFromU8(files[path])) : null);
  const shared: string[] = (read("xl/sharedStrings.xml")?.sst?.si ?? []).map(textOf);
  const workbook = read("xl/workbook.xml");
  const rels = (read("xl/_rels/workbook.xml.rels")?.Relationships?.Relationship ?? []) as Record<string, string>[];
  const sheets = (workbook?.workbook?.sheets?.sheet ?? []) as Record<string, string>[];
  const out: Table[] = [];
  for (const sheet of sheets) {
    const rid = sheet["@r:id"];
    const target = rels.find((r) => r["@Id"] === rid)?.["@Target"];
    if (!target) continue;
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\.\//, "")}`;
    const data = read(path)?.worksheet?.sheetData;
    const rows: Cell[][] = [];
    for (const r of (data?.row ?? []) as Record<string, unknown>[]) {
      const cells: Cell[] = [];
      for (const c of (r.c ?? []) as Record<string, unknown>[]) {
        const idx = COL(String(c["@r"] ?? "A"));
        const type = c["@t"];
        let value: Cell = null;
        if (type === "s") value = shared[Number(textOf(c.v))] ?? null;
        else if (type === "inlineStr") value = textOf(c.is);
        else if (type === "b") value = textOf(c.v) === "1" ? "true" : "false";
        else if (c.v !== undefined) {
          const raw = textOf(c.v);
          value = type === "str" || raw === "" || Number.isNaN(Number(raw)) ? raw : Number(raw);
        }
        cells[idx] = value === "" ? null : value;
      }
      if (cells.some((v) => v !== null && v !== undefined)) rows.push(Array.from(cells, (v) => v ?? null));
    }
    // Skip title rows: the header row is the first row with at least two text cells.
    const headerIndex = rows.findIndex((r) => r.filter((v) => typeof v === "string" && v.trim()).length >= 2);
    if (headerIndex < 0) continue;
    out.push({
      sheet: String(sheet["@name"] ?? `Sheet ${out.length + 1}`),
      headers: rows[headerIndex].map((h) => String(h ?? "").trim()),
      rows: rows.slice(headerIndex + 1),
    });
  }
  return out;
}

// ------------------------------------------------------------ detection

export type TableKind = "contacts" | "items" | "opening_balances" | "bank_lines" | "unknown";

const SYNONYMS: Record<string, string[]> = {
  name: ["name", "company", "company name", "firma", "firmenname", "unternehmen", "societe", "entreprise", "raison sociale", "ditta", "azienda", "organisation", "organization", "kunde", "customer", "client", "lieferant", "supplier", "fournisseur"],
  last_name: ["last name", "lastname", "surname", "nachname", "nom de famille", "cognome"],
  first_name: ["first name", "firstname", "vorname", "prenom", "nome"],
  email: ["email", "e mail", "mail", "courriel", "e mail adresse"],
  phone: ["phone", "telephone", "telefon", "tel", "telefono", "mobile", "handy", "natel", "phone number"],
  street: ["street", "strasse", "address", "adresse", "rue", "via", "indirizzo", "strasse nr", "address line 1"],
  postcode: ["zip", "zip code", "postcode", "postal code", "plz", "npa", "cap", "postleitzahl", "code postal"],
  city: ["city", "ort", "stadt", "ville", "localite", "citta", "localita", "town"],
  country: ["country", "land", "pays", "paese", "country code"],
  vat: ["vat", "vat number", "uid", "uid nummer", "mwst nr", "tva", "iva", "ide"],
  website: ["website", "web", "url", "homepage", "site"],
  iban: ["iban", "bank account"],
  item_name: ["item", "article", "artikel", "bezeichnung", "produkt", "product", "service", "leistung", "designation", "articolo", "item name", "produktname", "name"],
  price: ["price", "preis", "prix", "prezzo", "sale price", "verkaufspreis", "vk", "unit price", "vk preis", "tarif", "rate", "ansatz"],
  cost: ["cost", "einkaufspreis", "ek", "purchase price", "prix d achat", "costo", "ek preis"],
  sku: ["sku", "code", "artikelnummer", "item number", "article number", "art nr", "numero article", "codice"],
  unit: ["unit", "einheit", "unite", "unita"],
  description: ["description", "beschreibung", "descrizione", "details"],
  account: ["account", "konto", "compte", "conto", "account number", "kontonummer", "kto", "konto nr"],
  balance: ["balance", "saldo", "solde", "closing balance", "schlusssaldo", "endsaldo", "opening balance", "eroffnungssaldo"],
  debit: ["debit", "soll", "debit chf", "dare", "belastung", "ausgang", "withdrawal"],
  credit: ["credit", "haben", "credit chf", "avere", "gutschrift", "eingang", "deposit"],
  date: ["date", "datum", "data", "booking date", "buchungsdatum", "valuta", "value date", "date de comptabilisation"],
  amount: ["amount", "betrag", "montant", "importo", "amount chf", "betrag chf"],
  text: ["text", "buchungstext", "libelle", "description", "beschreibung", "descrizione", "details", "mitteilung", "communication", "verwendungszweck"],
  reference: ["reference", "referenz", "reference number", "riferimento", "qr reference"],
};

/** Maps headers to known fields: { field: columnIndex }. */
export function mapHeaders(headers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const norm = headers.map((h) => normalize(h));
  for (const [field, words] of Object.entries(SYNONYMS)) {
    const idx = norm.findIndex((h, i) => !Object.values(out).includes(i) && words.some((w) => h === w));
    const loose = idx >= 0 ? idx : norm.findIndex((h, i) => !Object.values(out).includes(i) && words.some((w) => w.length > 3 && h.includes(w)));
    if (loose >= 0) out[field] = loose;
  }
  return out;
}

export function detectTable(table: Table): { kind: TableKind; mapping: Record<string, number>; confidence: number } {
  const m = mapHeaders(table.headers);
  const has = (...f: string[]) => f.every((x) => x in m);
  const any = (...f: string[]) => f.filter((x) => x in m).length;
  const scores: [TableKind, number][] = [
    ["bank_lines", has("date") && (has("amount") || any("debit", "credit") > 0) ? 2 + any("text", "reference") : 0],
    ["opening_balances", has("account") && (has("balance") || any("debit", "credit") > 0) && !has("date") ? 3 : 0],
    ["items", (has("item_name") || has("name")) && (has("price") || has("cost")) ? 2 + any("sku", "unit", "description") : 0],
    ["contacts", (has("name") || has("last_name")) && any("email", "phone", "street", "postcode", "city", "vat") > 0 ? 1 + any("email", "phone", "street", "postcode", "city", "vat", "first_name") : 0],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const [kind, score] = scores[0];
  return { kind: score > 0 ? kind : "unknown", mapping: m, confidence: Math.min(1, score / 5) };
}

// ----------------------------------------------------------------- values

/** "1'234.50", "1.234,50", "-12,30", "CHF 99.–" → number. */
export function looseNumber(value: Cell): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  let s = value.replace(/[^\d,.\-'’]/g, "");
  if (!s) return null;
  s = s.replace(/['’]/g, "");
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  const n = Number(s.replace(/\.-$/, ""));
  return Number.isFinite(n) ? n : null;
}

/** Accepts ISO, Swiss (dd.mm.yyyy), slashes and Excel serial dates. */
export function looseDate(value: Cell): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && value > 20000 && value < 80000) {
    return new Date(Math.round((value - 25569) * 86_400_000)).toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

export function cell(row: Cell[], mapping: Record<string, number>, field: string): Cell {
  const idx = mapping[field];
  return idx === undefined ? null : (row[idx] ?? null);
}

export function cellText(row: Cell[], mapping: Record<string, number>, field: string): string | null {
  const v = cell(row, mapping, field);
  return v === null ? null : String(v).trim() || null;
}

/** Reads any supported spreadsheet file into tables. */
export function readTables(bytes: Uint8Array, name: string, mime?: string | null): Table[] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".xlsx") || mime?.includes("spreadsheetml")) return parseXlsx(bytes);
  return [parseCsv(new TextDecoder().decode(bytes))];
}
