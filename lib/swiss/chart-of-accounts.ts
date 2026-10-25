/**
 * Swiss SME chart of accounts (KMU-Kontenrahmen / plan comptable PME), trimmed
 * to the accounts most small and medium companies use. Names in DE/FR/IT/EN.
 */
export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type Lang = "de" | "fr" | "it" | "en";
type Names = [de: string, fr: string, it: string, en: string];

export interface AccountGroupSeed {
  number: string;
  type: AccountType;
  names: Names;
}

export interface AccountSeed {
  number: string;
  type: AccountType;
  names: Names;
  system?: boolean;
}

export const ACCOUNT_GROUPS: AccountGroupSeed[] = [
  { number: "1", type: "asset", names: ["Aktiven", "Actifs", "Attivi", "Assets"] },
  { number: "10", type: "asset", names: ["Umlaufvermögen", "Actif circulant", "Attivo circolante", "Current assets"] },
  { number: "100", type: "asset", names: ["Flüssige Mittel", "Liquidités", "Liquidità", "Cash and cash equivalents"] },
  { number: "106", type: "asset", names: ["Kurzfristig gehaltene Aktiven", "Titres à court terme", "Titoli a breve termine", "Short-term securities"] },
  { number: "110", type: "asset", names: ["Forderungen aus Lieferungen und Leistungen", "Créances résultant de ventes et prestations", "Crediti da forniture e prestazioni", "Trade receivables"] },
  { number: "114", type: "asset", names: ["Übrige kurzfristige Forderungen", "Autres créances à court terme", "Altri crediti a breve termine", "Other short-term receivables"] },
  { number: "120", type: "asset", names: ["Vorräte und nicht fakturierte Dienstleistungen", "Stocks et prestations non facturées", "Scorte e prestazioni non fatturate", "Inventories and unbilled services"] },
  { number: "130", type: "asset", names: ["Aktive Rechnungsabgrenzungen", "Actifs de régularisation", "Ratei e risconti attivi", "Prepaid expenses and accrued income"] },
  { number: "14", type: "asset", names: ["Anlagevermögen", "Actif immobilisé", "Attivo fisso", "Non-current assets"] },
  { number: "140", type: "asset", names: ["Finanzanlagen", "Immobilisations financières", "Immobilizzazioni finanziarie", "Financial assets"] },
  { number: "150", type: "asset", names: ["Mobile Sachanlagen", "Immobilisations corporelles meubles", "Immobilizzazioni materiali mobili", "Movable tangible assets"] },
  { number: "160", type: "asset", names: ["Immobile Sachanlagen", "Immobilisations corporelles immeubles", "Immobilizzazioni materiali immobili", "Real estate"] },
  { number: "170", type: "asset", names: ["Immaterielle Werte", "Immobilisations incorporelles", "Immobilizzazioni immateriali", "Intangible assets"] },
  { number: "2", type: "liability", names: ["Passiven", "Passifs", "Passivi", "Liabilities and equity"] },
  { number: "20", type: "liability", names: ["Kurzfristiges Fremdkapital", "Capitaux étrangers à court terme", "Capitale di terzi a breve termine", "Current liabilities"] },
  { number: "200", type: "liability", names: ["Verbindlichkeiten aus Lieferungen und Leistungen", "Dettes résultant d'achats et de prestations", "Debiti per forniture e prestazioni", "Trade payables"] },
  { number: "210", type: "liability", names: ["Kurzfristige verzinsliche Verbindlichkeiten", "Dettes à court terme portant intérêt", "Debiti a breve termine onerosi", "Short-term interest-bearing liabilities"] },
  { number: "220", type: "liability", names: ["Übrige kurzfristige Verbindlichkeiten", "Autres dettes à court terme", "Altri debiti a breve termine", "Other short-term liabilities"] },
  { number: "230", type: "liability", names: ["Passive Rechnungsabgrenzungen", "Passifs de régularisation", "Ratei e risconti passivi", "Accrued liabilities and provisions"] },
  { number: "24", type: "liability", names: ["Langfristiges Fremdkapital", "Capitaux étrangers à long terme", "Capitale di terzi a lungo termine", "Non-current liabilities"] },
  { number: "240", type: "liability", names: ["Langfristige verzinsliche Verbindlichkeiten", "Dettes à long terme portant intérêt", "Debiti a lungo termine onerosi", "Long-term interest-bearing liabilities"] },
  { number: "260", type: "liability", names: ["Rückstellungen", "Provisions", "Accantonamenti", "Provisions"] },
  { number: "28", type: "equity", names: ["Eigenkapital", "Capitaux propres", "Capitale proprio", "Equity"] },
  { number: "3", type: "revenue", names: ["Betriebsertrag aus Lieferungen und Leistungen", "Produits des ventes et prestations", "Ricavi da forniture e prestazioni", "Operating revenue"] },
  { number: "4", type: "expense", names: ["Aufwand für Material, Waren und Dienstleistungen", "Charges de matériel, marchandises et prestations", "Costi per materiale, merci e prestazioni", "Cost of materials, goods and services"] },
  { number: "5", type: "expense", names: ["Personalaufwand", "Charges de personnel", "Costi del personale", "Personnel expenses"] },
  { number: "6", type: "expense", names: ["Übriger betrieblicher Aufwand und Finanzergebnis", "Autres charges d'exploitation et résultat financier", "Altri costi d'esercizio e risultato finanziario", "Other operating expenses and financial result"] },
  { number: "7", type: "revenue", names: ["Betrieblicher Nebenerfolg", "Résultat des activités annexes", "Risultato delle attività accessorie", "Ancillary operating result"] },
  { number: "8", type: "expense", names: ["Betriebsfremder und ausserordentlicher Erfolg", "Résultat hors exploitation et exceptionnel", "Risultato estraneo e straordinario", "Non-operating and extraordinary result"] },
  { number: "9", type: "equity", names: ["Abschluss", "Clôture", "Chiusura", "Closing"] },
];

export const ACCOUNTS: AccountSeed[] = [
  { number: "1000", type: "asset", names: ["Kasse", "Caisse", "Cassa", "Cash"] },
  { number: "1020", type: "asset", names: ["Bankguthaben", "Avoirs bancaires", "Averi bancari", "Bank"] },
  { number: "1060", type: "asset", names: ["Wertschriften", "Titres", "Titoli", "Securities"] },
  { number: "1100", type: "asset", system: true, names: ["Forderungen aus Lieferungen und Leistungen", "Créances clients", "Crediti verso clienti", "Trade receivables"] },
  { number: "1109", type: "asset", names: ["Delkredere", "Ducroire", "Delcredere", "Allowance for doubtful accounts"] },
  { number: "1170", type: "asset", system: true, names: ["Vorsteuer MWST Material und Dienstleistungen", "Impôt préalable TVA matériel et prestations", "Imposta precedente IVA materiale e prestazioni", "Input VAT on materials and services"] },
  { number: "1171", type: "asset", system: true, names: ["Vorsteuer MWST Investitionen und übriger Betriebsaufwand", "Impôt préalable TVA investissements et autres charges", "Imposta precedente IVA investimenti e altri costi", "Input VAT on investments and operating expenses"] },
  { number: "1176", type: "asset", names: ["Verrechnungssteuer", "Impôt anticipé", "Imposta preventiva", "Withholding tax receivable"] },
  { number: "1190", type: "asset", names: ["Sonstige kurzfristige Forderungen", "Autres créances à court terme", "Altri crediti a breve termine", "Other short-term receivables"] },
  { number: "1200", type: "asset", names: ["Handelswaren", "Marchandises", "Merci", "Merchandise inventory"] },
  { number: "1280", type: "asset", names: ["Nicht fakturierte Dienstleistungen", "Prestations non facturées", "Prestazioni non fatturate", "Unbilled services"] },
  { number: "1300", type: "asset", names: ["Bezahlter Aufwand des Folgejahres", "Charges payées d'avance", "Costi pagati in anticipo", "Prepaid expenses"] },
  { number: "1301", type: "asset", names: ["Noch nicht erhaltener Ertrag", "Produits à recevoir", "Ricavi da incassare", "Accrued income"] },
  { number: "1400", type: "asset", names: ["Wertschriften des Anlagevermögens", "Titres à long terme", "Titoli a lungo termine", "Long-term securities"] },
  { number: "1440", type: "asset", names: ["Darlehen", "Prêts", "Prestiti", "Loans receivable"] },
  { number: "1500", type: "asset", names: ["Maschinen und Apparate", "Machines et appareils", "Macchine e apparecchi", "Machinery and equipment"] },
  { number: "1510", type: "asset", names: ["Mobiliar und Einrichtungen", "Mobilier et installations", "Mobilio e installazioni", "Furniture and fixtures"] },
  { number: "1520", type: "asset", names: ["Büromaschinen und Informatik", "Machines de bureau et informatique", "Macchine d'ufficio e informatica", "Office equipment and IT"] },
  { number: "1530", type: "asset", names: ["Fahrzeuge", "Véhicules", "Veicoli", "Vehicles"] },
  { number: "1540", type: "asset", names: ["Werkzeuge und Geräte", "Outillage et appareils", "Utensili e attrezzi", "Tools and equipment"] },
  { number: "1600", type: "asset", names: ["Geschäftsliegenschaften", "Immeubles d'exploitation", "Immobili aziendali", "Business premises"] },
  { number: "1700", type: "asset", names: ["Patente, Lizenzen und Rechte", "Brevets, licences et droits", "Brevetti, licenze e diritti", "Patents, licences and rights"] },
  { number: "1770", type: "asset", names: ["Goodwill", "Goodwill", "Goodwill", "Goodwill"] },
  { number: "2000", type: "liability", system: true, names: ["Verbindlichkeiten aus Lieferungen und Leistungen", "Dettes fournisseurs", "Debiti verso fornitori", "Trade payables"] },
  { number: "2030", type: "liability", names: ["Erhaltene Anzahlungen", "Acomptes reçus", "Acconti ricevuti", "Customer prepayments"] },
  { number: "2100", type: "liability", names: ["Bankverbindlichkeiten", "Dettes bancaires", "Debiti bancari", "Bank overdrafts"] },
  { number: "2120", type: "liability", names: ["Verbindlichkeiten aus Leasing", "Engagements de leasing", "Debiti da leasing", "Lease liabilities"] },
  { number: "2200", type: "liability", system: true, names: ["Geschuldete MWST", "TVA due", "IVA dovuta", "VAT payable"] },
  { number: "2201", type: "liability", system: true, names: ["Abrechnungskonto MWST", "Décompte TVA", "Conto di conteggio IVA", "VAT settlement account"] },
  { number: "2206", type: "liability", names: ["Verrechnungssteuer", "Impôt anticipé dû", "Imposta preventiva dovuta", "Withholding tax payable"] },
  { number: "2210", type: "liability", names: ["Sonstige kurzfristige Verbindlichkeiten", "Autres dettes à court terme", "Altri debiti a breve termine", "Other short-term liabilities"] },
  { number: "2261", type: "liability", names: ["Beschlossene Ausschüttungen", "Dividendes décidés", "Dividendi deliberati", "Dividends payable"] },
  { number: "2270", type: "liability", system: true, names: ["Sozialversicherungen und Vorsorgeeinrichtungen", "Assurances sociales et prévoyance", "Assicurazioni sociali e previdenza", "Social security and pension liabilities"] },
  { number: "2279", type: "liability", system: true, names: ["Quellensteuer", "Impôt à la source", "Imposta alla fonte", "Withholding tax on salaries"] },
  { number: "2300", type: "liability", names: ["Noch nicht bezahlter Aufwand", "Charges à payer", "Costi da pagare", "Accrued expenses"] },
  { number: "2301", type: "liability", names: ["Erhaltener Ertrag des Folgejahres", "Produits encaissés d'avance", "Ricavi incassati in anticipo", "Deferred income"] },
  { number: "2330", type: "liability", names: ["Kurzfristige Rückstellungen", "Provisions à court terme", "Accantonamenti a breve termine", "Short-term provisions"] },
  { number: "2400", type: "liability", names: ["Bankdarlehen", "Emprunts bancaires", "Prestiti bancari", "Bank loans"] },
  { number: "2450", type: "liability", names: ["Darlehen", "Emprunts", "Prestiti", "Loans"] },
  { number: "2600", type: "liability", names: ["Rückstellungen", "Provisions", "Accantonamenti", "Provisions"] },
  { number: "2800", type: "equity", names: ["Aktien-, Stamm- oder Anteilscheinkapital", "Capital-actions ou capital social", "Capitale azionario o sociale", "Share capital"] },
  { number: "2900", type: "equity", names: ["Gesetzliche Kapitalreserve", "Réserve légale issue du capital", "Riserva legale da capitale", "Statutory capital reserve"] },
  { number: "2950", type: "equity", names: ["Gesetzliche Gewinnreserve", "Réserve légale issue du bénéfice", "Riserva legale da utili", "Statutory retained earnings reserve"] },
  { number: "2960", type: "equity", names: ["Freiwillige Gewinnreserven", "Réserves facultatives", "Riserve facoltative", "Voluntary reserves"] },
  { number: "2970", type: "equity", system: true, names: ["Gewinnvortrag / Verlustvortrag", "Bénéfice / perte reporté", "Utile / perdita riportata", "Retained earnings"] },
  { number: "2979", type: "equity", system: true, names: ["Jahresgewinn / Jahresverlust", "Bénéfice / perte de l'exercice", "Utile / perdita d'esercizio", "Profit / loss for the year"] },
  { number: "3000", type: "revenue", names: ["Produktionserlöse", "Ventes de produits fabriqués", "Ricavi della produzione", "Production revenue"] },
  { number: "3200", type: "revenue", names: ["Handelserlöse", "Ventes de marchandises", "Ricavi da merci", "Merchandise revenue"] },
  { number: "3400", type: "revenue", system: true, names: ["Dienstleistungserlöse", "Ventes de prestations", "Ricavi da prestazioni", "Service revenue"] },
  { number: "3600", type: "revenue", names: ["Übrige Erlöse aus Lieferungen und Leistungen", "Autres ventes et prestations", "Altri ricavi", "Other revenue"] },
  { number: "3700", type: "revenue", names: ["Eigenleistungen", "Prestations propres", "Prestazioni proprie", "Own work capitalised"] },
  { number: "3800", type: "revenue", names: ["Erlösminderungen", "Déductions sur ventes", "Riduzioni dei ricavi", "Sales deductions"] },
  { number: "3801", type: "revenue", system: true, names: ["Gewährte Skonti", "Escomptes accordés", "Sconti concessi", "Cash discounts granted"] },
  { number: "3805", type: "revenue", names: ["Verluste aus Forderungen", "Pertes sur créances", "Perdite su crediti", "Bad debt losses"] },
  { number: "3806", type: "revenue", system: true, names: ["Kursdifferenzen", "Différences de change", "Differenze di cambio", "Exchange differences"] },
  { number: "3900", type: "revenue", names: ["Bestandesänderungen", "Variation des stocks", "Variazione delle scorte", "Change in inventories"] },
  { number: "4000", type: "expense", names: ["Materialaufwand", "Charges de matériel", "Costi del materiale", "Cost of materials"] },
  { number: "4200", type: "expense", names: ["Handelswarenaufwand", "Achats de marchandises", "Costi delle merci", "Cost of merchandise"] },
  { number: "4400", type: "expense", system: true, names: ["Aufwand für bezogene Dienstleistungen", "Prestations de tiers", "Prestazioni di terzi", "Purchased services"] },
  { number: "4500", type: "expense", names: ["Energieaufwand zur Leistungserstellung", "Énergie pour l'exploitation", "Energia per la produzione", "Energy costs"] },
  { number: "4900", type: "expense", names: ["Aufwandminderungen", "Déductions sur les charges", "Riduzioni dei costi", "Purchase deductions"] },
  { number: "4901", type: "expense", system: true, names: ["Erhaltene Skonti", "Escomptes obtenus", "Sconti ottenuti", "Cash discounts received"] },
  { number: "5000", type: "expense", system: true, names: ["Lohnaufwand", "Salaires", "Salari", "Salaries"] },
  { number: "5700", type: "expense", system: true, names: ["Sozialversicherungsaufwand", "Charges sociales", "Oneri sociali", "Social security expenses"] },
  { number: "5800", type: "expense", names: ["Übriger Personalaufwand", "Autres charges de personnel", "Altri costi del personale", "Other personnel expenses"] },
  { number: "5900", type: "expense", names: ["Leistungen Dritter", "Prestations de travail de tiers", "Prestazioni di lavoro di terzi", "Temporary staff"] },
  { number: "6000", type: "expense", names: ["Raumaufwand", "Charges de locaux", "Spese per locali", "Rent and premises"] },
  { number: "6100", type: "expense", names: ["Unterhalt, Reparaturen, Ersatz", "Entretien et réparations", "Manutenzione e riparazioni", "Maintenance and repairs"] },
  { number: "6200", type: "expense", names: ["Fahrzeug- und Transportaufwand", "Charges de véhicules et de transport", "Costi veicoli e trasporti", "Vehicle and transport expenses"] },
  { number: "6300", type: "expense", names: ["Sachversicherungen, Abgaben, Gebühren", "Assurances, droits et taxes", "Assicurazioni, tasse e diritti", "Insurance, duties and fees"] },
  { number: "6400", type: "expense", names: ["Energie- und Entsorgungsaufwand", "Énergie et évacuation des déchets", "Energia e smaltimento", "Energy and waste disposal"] },
  { number: "6500", type: "expense", system: true, names: ["Verwaltungsaufwand", "Charges d'administration", "Costi amministrativi", "Administrative expenses"] },
  { number: "6510", type: "expense", names: ["Telefon, Internet, Porti", "Téléphone, internet, frais de port", "Telefono, internet, spese postali", "Telephone, internet and postage"] },
  { number: "6530", type: "expense", names: ["Buchführungs- und Beratungsaufwand", "Honoraires fiduciaires et de conseil", "Onorari contabili e di consulenza", "Accounting and consulting fees"] },
  { number: "6570", type: "expense", names: ["Informatikaufwand", "Charges informatiques", "Costi informatici", "IT expenses"] },
  { number: "6600", type: "expense", names: ["Werbeaufwand", "Publicité", "Pubblicità", "Advertising"] },
  { number: "6700", type: "expense", names: ["Sonstiger betrieblicher Aufwand", "Autres charges d'exploitation", "Altri costi d'esercizio", "Other operating expenses"] },
  { number: "6800", type: "expense", names: ["Abschreibungen und Wertberichtigungen", "Amortissements et corrections de valeur", "Ammortamenti e rettifiche di valore", "Depreciation and impairment"] },
  { number: "6900", type: "expense", names: ["Finanzaufwand", "Charges financières", "Oneri finanziari", "Financial expenses"] },
  { number: "6940", type: "expense", names: ["Bankspesen", "Frais bancaires", "Spese bancarie", "Bank charges"] },
  { number: "6950", type: "revenue", names: ["Finanzertrag", "Produits financiers", "Proventi finanziari", "Financial income"] },
  { number: "7000", type: "revenue", names: ["Ertrag Nebenbetrieb", "Produits des activités annexes", "Ricavi attività accessorie", "Ancillary revenue"] },
  { number: "7010", type: "expense", names: ["Aufwand Nebenbetrieb", "Charges des activités annexes", "Costi attività accessorie", "Ancillary expenses"] },
  { number: "7500", type: "revenue", names: ["Ertrag betriebliche Liegenschaft", "Produits des immeubles d'exploitation", "Ricavi immobili aziendali", "Property income"] },
  { number: "8000", type: "expense", names: ["Betriebsfremder Aufwand", "Charges hors exploitation", "Costi estranei all'esercizio", "Non-operating expenses"] },
  { number: "8100", type: "revenue", names: ["Betriebsfremder Ertrag", "Produits hors exploitation", "Ricavi estranei all'esercizio", "Non-operating income"] },
  { number: "8500", type: "expense", names: ["Ausserordentlicher Aufwand", "Charges exceptionnelles", "Costi straordinari", "Extraordinary expenses"] },
  { number: "8510", type: "revenue", names: ["Ausserordentlicher Ertrag", "Produits exceptionnels", "Ricavi straordinari", "Extraordinary income"] },
  { number: "8900", type: "expense", names: ["Direkte Steuern", "Impôts directs", "Imposte dirette", "Direct taxes"] },
  { number: "9100", type: "equity", system: true, names: ["Eröffnungsbilanz", "Bilan d'ouverture", "Bilancio d'apertura", "Opening balance"] },
  { number: "9200", type: "equity", system: true, names: ["Gewinn / Verlust", "Bénéfice / perte", "Utile / perdita", "Profit / loss"] },
];

const LANG_INDEX: Record<Lang, number> = { de: 0, fr: 1, it: 2, en: 3 };

export function localName(names: Names, lang: Lang): string {
  return names[LANG_INDEX[lang] ?? 0];
}

/** Group numbers are lower bounds of account ranges: group "150" covers 1500–1599 until the next group. */
const lowerBound = (n: string) => Number(n.padEnd(4, "0"));

function deepest(candidates: AccountGroupSeed[], length: number, min = 0): AccountGroupSeed | undefined {
  return candidates
    .filter((g) => g.number.length === length && lowerBound(g.number) >= min)
    .sort((a, b) => lowerBound(b.number) - lowerBound(a.number))[0];
}

/** Most specific group an account number belongs to (e.g. 1170 → 114, 2800 → 28). */
export function groupFor(accountNumber: string): string | null {
  const value = Number(accountNumber.padEnd(4, "0"));
  const candidates = ACCOUNT_GROUPS.filter((g) => g.number[0] === accountNumber[0] && lowerBound(g.number) <= value);
  const cls = deepest(candidates, 2);
  const group = deepest(candidates, 3, cls ? lowerBound(cls.number) : 0);
  return group?.number ?? cls?.number ?? deepest(candidates, 1)?.number ?? null;
}

/** Parent of an account group (3-digit → 2-digit class → 1-digit). */
export function parentGroupFor(groupNumber: string): string | null {
  if (groupNumber.length <= 1) return null;
  const value = lowerBound(groupNumber);
  const candidates = ACCOUNT_GROUPS.filter((g) => g.number[0] === groupNumber[0] && g.number.length < groupNumber.length && lowerBound(g.number) <= value);
  return (deepest(candidates, groupNumber.length - 1) ?? deepest(candidates, 1))?.number ?? null;
}

/** Well-known system accounts used by automatic bookings. */
export const SYSTEM_ACCOUNTS = {
  cash: "1000",
  bank: "1020",
  receivables: "1100",
  inputVatMaterial: "1170",
  inputVatInvestment: "1171",
  payables: "2000",
  vatPayable: "2200",
  vatSettlement: "2201",
  socialSecurity: "2270",
  withholdingTax: "2279",
  retainedEarnings: "2970",
  annualProfit: "2979",
  serviceRevenue: "3400",
  cashDiscountGranted: "3801",
  exchangeDifferences: "3806",
  purchasedServices: "4400",
  cashDiscountReceived: "4901",
  salaries: "5000",
  socialSecurityExpense: "5700",
  adminExpense: "6500",
  openingBalance: "9100",
  profitLoss: "9200",
} as const;
