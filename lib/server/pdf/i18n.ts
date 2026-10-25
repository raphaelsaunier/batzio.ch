export type DocLang = "de" | "fr" | "it" | "en";

const T = {
  quote: ["Offerte", "Offre", "Offerta", "Quote"],
  order: ["Auftragsbestätigung", "Confirmation de commande", "Conferma d'ordine", "Order confirmation"],
  delivery: ["Lieferschein", "Bulletin de livraison", "Bollettino di consegna", "Delivery note"],
  invoice: ["Rechnung", "Facture", "Fattura", "Invoice"],
  credit_note: ["Gutschrift", "Note de crédit", "Nota di credito", "Credit note"],
  purchase_order: ["Bestellung", "Bon de commande", "Ordine d'acquisto", "Purchase order"],
  reminder: ["Zahlungserinnerung", "Rappel de paiement", "Sollecito di pagamento", "Payment reminder"],
  date: ["Datum", "Date", "Data", "Date"],
  due_invoice: ["Zahlbar bis", "Payable jusqu'au", "Pagabile entro", "Due date"],
  due_quote: ["Gültig bis", "Valable jusqu'au", "Valida fino al", "Valid until"],
  due_delivery: ["Lieferdatum", "Date de livraison", "Data di consegna", "Delivery date"],
  customer_no: ["Kunden-Nr.", "N° client", "N. cliente", "Customer no."],
  reference: ["Ihre Referenz", "Votre référence", "Vostro riferimento", "Your reference"],
  contact: ["Kontakt", "Contact", "Contatto", "Contact"],
  vat_no: ["MWST-Nr.", "N° TVA", "N. IVA", "VAT no."],
  pos: ["Pos.", "Pos.", "Pos.", "Pos."],
  description: ["Beschreibung", "Description", "Descrizione", "Description"],
  qty: ["Menge", "Quantité", "Quantità", "Qty"],
  unit: ["Einheit", "Unité", "Unità", "Unit"],
  price: ["Preis", "Prix", "Prezzo", "Price"],
  discount: ["Rabatt", "Rabais", "Sconto", "Disc."],
  total: ["Total", "Total", "Totale", "Total"],
  subtotal: ["Zwischentotal", "Sous-total", "Subtotale", "Subtotal"],
  net_total: ["Total exkl. MWST", "Total hors TVA", "Totale IVA esclusa", "Total excl. VAT"],
  vat_on: ["MWST {rate}% auf", "TVA {rate}% sur", "IVA {rate}% su", "VAT {rate}% on"],
  vat_incl: ["inkl. MWST {rate}%", "TVA {rate}% incluse", "IVA {rate}% inclusa", "incl. VAT {rate}%"],
  rounding: ["Rundung", "Arrondi", "Arrotondamento", "Rounding"],
  total_amount: ["Gesamtbetrag", "Montant total", "Importo totale", "Total amount"],
  paid: ["Bereits bezahlt", "Déjà payé", "Già pagato", "Already paid"],
  open_amount: ["Offener Betrag", "Montant ouvert", "Importo aperto", "Amount due"],
  optional: ["Optional", "Optionnel", "Opzionale", "Optional"],
  page: ["Seite", "Page", "Pagina", "Page"],
  fee: ["Mahngebühr", "Frais de rappel", "Spese di sollecito", "Reminder fee"],
  original_due: ["Ursprünglich fällig am", "Échéance initiale", "Scadenza originale", "Originally due"],
  invoice_amount: ["Rechnungsbetrag", "Montant de la facture", "Importo fattura", "Invoice amount"],
  // QR-bill (official wording per language)
  qr_receipt: ["Empfangsschein", "Récépissé", "Ricevuta", "Receipt"],
  qr_payment_part: ["Zahlteil", "Section paiement", "Sezione pagamento", "Payment part"],
  qr_account: ["Konto / Zahlbar an", "Compte / Payable à", "Conto / Pagabile a", "Account / Payable to"],
  qr_reference: ["Referenz", "Référence", "Riferimento", "Reference"],
  qr_additional: ["Zusätzliche Informationen", "Informations supplémentaires", "Informazioni supplementari", "Additional information"],
  qr_payable_by: ["Zahlbar durch", "Payable par", "Pagabile da", "Payable by"],
  qr_payable_by_blank: ["Zahlbar durch (Name/Adresse)", "Payable par (nom/adresse)", "Pagabile da (nome/indirizzo)", "Payable by (name/address)"],
  qr_currency: ["Währung", "Monnaie", "Valuta", "Currency"],
  qr_amount: ["Betrag", "Montant", "Importo", "Amount"],
  qr_acceptance: ["Annahmestelle", "Point de dépôt", "Punto di accettazione", "Acceptance point"],
  qr_separate: ["Vor der Einzahlung abzutrennen", "A détacher avant le versement", "Da staccare prima del versamento", "Separate before paying in"],
} as const;

const IDX: Record<DocLang, number> = { de: 0, fr: 1, it: 2, en: 3 };

export type LabelKey = keyof typeof T;

export function t(lang: string, key: LabelKey, vars: Record<string, string> = {}): string {
  const idx = IDX[(lang as DocLang) in IDX ? (lang as DocLang) : "de"];
  let s: string = T[key][idx];
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}
