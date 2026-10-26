import { strToU8, zipSync } from "fflate";

/**
 * Minimal, dependency-free XLSX (SpreadsheetML) writer that runs in Workers.
 * Supports multiple sheets, typed cells, number/date formats, bold headers,
 * column widths, frozen header rows and auto-filters.
 */

export type CellType = "string" | "number" | "money" | "date" | "percent" | "integer" | "boolean";

export interface SheetColumn {
  header: string;
  type?: CellType;
  width?: number;
}

export type CellValue = string | number | boolean | null | undefined;

export interface SheetRow {
  cells: CellValue[];
  /** Renders the row in bold (totals, section headings). */
  bold?: boolean;
}

export interface Sheet {
  name: string;
  columns: SheetColumn[];
  rows: (CellValue[] | SheetRow)[];
  /** Optional title rows above the table. */
  title?: string[];
}

const esc = (v: string) =>
  v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function colName(index: number): string {
  let s = "";
  let n = index + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel serial date (1900 system). */
function excelDate(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return utc / 86_400_000 + 25569;
}

// Style ids: 0 normal, 1 header, 2 money, 3 date, 4 percent, 5 integer, 6 bold, 7 bold money, 8 title, 9 decimal
const STYLE: Record<CellType, number> = { string: 0, number: 9, money: 2, date: 3, percent: 4, integer: 5, boolean: 0 };

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/><numFmt numFmtId="166" formatCode="0.00&quot;%&quot;"/></numFmts>
<fonts count="3"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="12"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF2F5F8F"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(ref: string, value: CellValue, type: CellType, bold: boolean): string {
  if (value === null || value === undefined || value === "") return "";
  if (type === "date" && typeof value === "string") {
    const serial = excelDate(value);
    if (serial !== null) return `<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`;
  }
  if (type === "boolean") return `<c r="${ref}" t="inlineStr"><is><t>${value ? "Yes" : "No"}</t></is></c>`;
  if (type !== "string" && typeof value === "number" && Number.isFinite(value)) {
    const style = bold ? (type === "money" ? 7 : 6) : STYLE[type];
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"${bold ? ' s="6"' : ""}><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
  const rows: string[] = [];
  let r = 1;
  for (const line of sheet.title ?? []) {
    rows.push(`<row r="${r}"><c r="A${r}" t="inlineStr" s="8"><is><t>${esc(line)}</t></is></c></row>`);
    r++;
  }
  if (sheet.title?.length) r++;
  const headerRow = r;
  rows.push(
    `<row r="${r}">${sheet.columns
      .map((c, i) => `<c r="${colName(i)}${r}" t="inlineStr" s="1"><is><t>${esc(c.header)}</t></is></c>`)
      .join("")}</row>`,
  );
  r++;
  for (const raw of sheet.rows) {
    const row: SheetRow = Array.isArray(raw) ? { cells: raw } : raw;
    rows.push(
      `<row r="${r}">${row.cells
        .map((v, i) => cellXml(`${colName(i)}${r}`, v, sheet.columns[i]?.type ?? "string", !!row.bold))
        .join("")}</row>`,
    );
    r++;
  }
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? (c.type === "string" || !c.type ? 24 : 14)}" customWidth="1"/>`)
    .join("");
  const lastCol = colName(Math.max(0, sheet.columns.length - 1));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${cols}</cols>
<sheetData>${rows.join("")}</sheetData>
${sheet.rows.length ? `<autoFilter ref="A${headerRow}:${lastCol}${headerRow + sheet.rows.length}"/>` : ""}
</worksheet>`;
}

const safeSheetName = (name: string, used: Set<string>) => {
  let base = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Sheet";
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) candidate = `${base.slice(0, 28)} ${i++}`;
  used.add(candidate);
  return candidate;
};

export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const used = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, used));
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>Batzio</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created>
</cp:coreProperties>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/styles.xml": strToU8(STYLES_XML),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))));
  return zipSync(files, { level: 6 });
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
