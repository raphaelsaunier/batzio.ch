import type { Ctx } from "./ctx";

export interface CompanySettings {
  name: string;
  legal_form: string;
  street: string;
  house_number: string;
  postcode: string;
  city: string;
  country_code: string;
  phone: string;
  email: string;
  website: string;
  vat_number: string;
  commercial_register: string;
  language: "de" | "fr" | "it" | "en";
  logo_file_id: number | null;
  accent_color: string;
}

export interface AccountingSettings {
  vat_registered: boolean;
  vat_method: "effective" | "net_tax_rate";
  vat_period: "quarterly" | "semiannual" | "monthly";
  base_currency: string;
  /** Final total rounding for CHF documents (0.05 = 5 Rappen). */
  chf_rounding: number;
  default_payment_days: number;
  quote_validity_days: number;
  reminder_fees: [number, number, number];
  reminder_days: number;
}

export interface DocumentTexts {
  quote_header: string;
  quote_footer: string;
  order_header: string;
  invoice_header: string;
  invoice_footer: string;
  credit_note_header: string;
  delivery_header: string;
  reminder_header: string;
}

export const DEFAULT_COMPANY: CompanySettings = {
  name: "",
  legal_form: "",
  street: "",
  house_number: "",
  postcode: "",
  city: "",
  country_code: "CH",
  phone: "",
  email: "",
  website: "",
  vat_number: "",
  commercial_register: "",
  language: "de",
  logo_file_id: null,
  accent_color: "#2f5f8f",
};

export const DEFAULT_ACCOUNTING: AccountingSettings = {
  vat_registered: true,
  vat_method: "effective",
  vat_period: "quarterly",
  base_currency: "CHF",
  chf_rounding: 0.05,
  default_payment_days: 30,
  quote_validity_days: 30,
  reminder_fees: [0, 20, 30],
  reminder_days: 10,
};

/** Company-specific overrides; empty values fall back to the localized defaults below. */
export const DEFAULT_TEXTS: DocumentTexts = {
  quote_header: "",
  quote_footer: "",
  order_header: "",
  invoice_header: "",
  invoice_footer: "",
  credit_note_header: "",
  delivery_header: "",
  reminder_header: "",
};

export const LOCALIZED_TEXTS: Record<"de" | "fr" | "it" | "en", DocumentTexts> = {
  de: {
    quote_header: "Vielen Dank für Ihr Interesse. Gerne unterbreiten wir Ihnen folgendes Angebot.",
    quote_footer: "Wir freuen uns auf Ihren Auftrag.",
    order_header: "Vielen Dank für Ihren Auftrag, den wir wie folgt bestätigen.",
    invoice_header: "Für unsere Leistungen erlauben wir uns, Ihnen folgenden Betrag in Rechnung zu stellen.",
    invoice_footer: "Vielen Dank für die gute Zusammenarbeit.",
    credit_note_header: "Wir schreiben Ihnen folgenden Betrag gut.",
    delivery_header: "Wir liefern Ihnen folgende Positionen.",
    reminder_header: "Gemäss unserer Buchhaltung ist die folgende Rechnung noch offen. Bitte begleichen Sie den Betrag innert der angegebenen Frist. Sollte sich Ihre Zahlung mit diesem Schreiben gekreuzt haben, betrachten Sie es bitte als gegenstandslos.",
  },
  fr: {
    quote_header: "Nous vous remercions de votre intérêt et avons le plaisir de vous soumettre l'offre suivante.",
    quote_footer: "Dans l'attente de votre commande, nous vous adressons nos meilleures salutations.",
    order_header: "Nous vous remercions de votre commande que nous confirmons comme suit.",
    invoice_header: "Nous nous permettons de vous facturer nos prestations comme suit.",
    invoice_footer: "Nous vous remercions de votre confiance.",
    credit_note_header: "Nous vous créditons le montant suivant.",
    delivery_header: "Nous vous livrons les positions suivantes.",
    reminder_header: "Selon notre comptabilité, la facture suivante est encore ouverte. Nous vous prions de régler le montant dans le délai indiqué. Si votre paiement a croisé ce courrier, veuillez le considérer comme nul.",
  },
  it: {
    quote_header: "La ringraziamo per l'interesse e le sottoponiamo volentieri la seguente offerta.",
    quote_footer: "Restiamo in attesa del suo ordine.",
    order_header: "La ringraziamo per l'ordine, che confermiamo come segue.",
    invoice_header: "Ci permettiamo di fatturarle le nostre prestazioni come segue.",
    invoice_footer: "La ringraziamo per la fiducia.",
    credit_note_header: "Le accreditiamo il seguente importo.",
    delivery_header: "Le consegniamo le seguenti posizioni.",
    reminder_header: "Secondo la nostra contabilità la seguente fattura risulta ancora aperta. La preghiamo di saldare l'importo entro il termine indicato. Se il pagamento si fosse incrociato con questa lettera, la consideri nulla.",
  },
  en: {
    quote_header: "Thank you for your interest. We are pleased to submit the following offer.",
    quote_footer: "We look forward to your order.",
    order_header: "Thank you for your order, which we confirm as follows.",
    invoice_header: "We invoice you for our services as follows.",
    invoice_footer: "Thank you for your business.",
    credit_note_header: "We credit you the following amount.",
    delivery_header: "We deliver the following items.",
    reminder_header: "According to our records, the following invoice is still open. Please settle the amount within the stated period. If your payment has crossed with this letter, please disregard it.",
  },
};

/** Effective document text: the company's override or the localized default. */
export function documentText(texts: DocumentTexts, lang: string, key: keyof DocumentTexts): string | null {
  const own = texts[key];
  if (own) return own;
  const set = LOCALIZED_TEXTS[(lang as keyof typeof LOCALIZED_TEXTS) in LOCALIZED_TEXTS ? (lang as keyof typeof LOCALIZED_TEXTS) : "de"];
  return set[key] || null;
}

type SettingsMap = {
  company: CompanySettings;
  accounting: AccountingSettings;
  texts: DocumentTexts;
};

const DEFAULTS: SettingsMap = { company: DEFAULT_COMPANY, accounting: DEFAULT_ACCOUNTING, texts: DEFAULT_TEXTS };

export async function getSettings<K extends keyof SettingsMap>(ctx: Ctx, key: K): Promise<SettingsMap[K]> {
  const row = await ctx.db.first<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  let stored: Partial<SettingsMap[K]> = {};
  if (row) {
    try {
      stored = JSON.parse(row.value);
    } catch {
      stored = {};
    }
  }
  return { ...DEFAULTS[key], ...stored };
}

export async function saveSettings<K extends keyof SettingsMap>(ctx: Ctx, key: K, value: Partial<SettingsMap[K]>) {
  const current = await getSettings(ctx, key);
  const next = { ...current, ...value };
  await ctx.db.run(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    JSON.stringify(next),
    new Date().toISOString(),
  );
  return next;
}
