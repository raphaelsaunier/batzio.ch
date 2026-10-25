/** Swiss VAT (MWST/TVA/IVA) defaults, valid since 1 January 2024. */

export interface TaxSeed {
  code: string;
  name: string;
  rate: number;
  type: "sales" | "purchase";
  category: "standard" | "reduced" | "accommodation" | "zero" | "exempt" | "investment";
  accountNumber: string | null;
  vatFormDigit: string | null;
}

/**
 * Codes follow the usual Swiss convention:
 *  - UN/UR/US: turnover tax (normal/reduced/special accommodation rate)
 *  - VM: input tax on material & services, VI: input tax on investments/other expenses
 * Form digits refer to the ESTV effective-method VAT return.
 */
export const DEFAULT_TAXES: TaxSeed[] = [
  { code: "UN81", name: "VAT 8.1% (standard)", rate: 8.1, type: "sales", category: "standard", accountNumber: "2200", vatFormDigit: "303" },
  { code: "UR26", name: "VAT 2.6% (reduced)", rate: 2.6, type: "sales", category: "reduced", accountNumber: "2200", vatFormDigit: "313" },
  { code: "US38", name: "VAT 3.8% (accommodation)", rate: 3.8, type: "sales", category: "accommodation", accountNumber: "2200", vatFormDigit: "343" },
  { code: "UEX", name: "Export / services abroad 0%", rate: 0, type: "sales", category: "zero", accountNumber: null, vatFormDigit: "221" },
  { code: "UNO", name: "Excluded from VAT", rate: 0, type: "sales", category: "exempt", accountNumber: null, vatFormDigit: "230" },
  { code: "VM81", name: "Input VAT 8.1% material/services", rate: 8.1, type: "purchase", category: "standard", accountNumber: "1170", vatFormDigit: "400" },
  { code: "VM26", name: "Input VAT 2.6% material/services", rate: 2.6, type: "purchase", category: "reduced", accountNumber: "1170", vatFormDigit: "400" },
  { code: "VM38", name: "Input VAT 3.8% material/services", rate: 3.8, type: "purchase", category: "accommodation", accountNumber: "1170", vatFormDigit: "400" },
  { code: "VI81", name: "Input VAT 8.1% investments/operating", rate: 8.1, type: "purchase", category: "investment", accountNumber: "1171", vatFormDigit: "405" },
  { code: "VI26", name: "Input VAT 2.6% investments/operating", rate: 2.6, type: "purchase", category: "investment", accountNumber: "1171", vatFormDigit: "405" },
  { code: "VI38", name: "Input VAT 3.8% investments/operating", rate: 3.8, type: "purchase", category: "investment", accountNumber: "1171", vatFormDigit: "405" },
];

/** Labels of the ESTV VAT return digits used in the VAT report. */
export const VAT_FORM_DIGITS: Record<string, string> = {
  "200": "Total agreed or collected consideration",
  "221": "Supplies abroad",
  "230": "Supplies exempt from tax",
  "289": "Total deductions",
  "299": "Taxable turnover",
  "303": "Standard rate 8.1%",
  "313": "Reduced rate 2.6%",
  "343": "Accommodation rate 3.8%",
  "399": "Total tax due",
  "400": "Input tax on cost of materials and services",
  "405": "Input tax on investments and other operating expenses",
  "479": "Total input tax",
  "500": "Amount payable",
  "510": "Credit in favour of the taxable person",
};
