import type { CatalogRow } from "./catalog";

// Rows are [en, de, fr, it]: letterhead, page footer, bank account and logo on the A4 document editor.
export const ROWS: CatalogRow[] = [
  ["Letterhead", "Briefkopf", "En-tête", "Intestazione"],
  ["Footer", "Fusszeile", "Pied de page", "Piè di pagina"],
  ["Page footer", "Fusszeile", "Pied de page", "Piè di pagina"],
  [
    "Two lines at most, at the bottom of every page. Leave empty to print company, address, UID and IBAN.",
    "Höchstens zwei Zeilen, unten auf jeder Seite. Leer lassen, um Firma, Adresse, UID und IBAN zu drucken.",
    "Deux lignes au plus, en bas de chaque page. Laissez vide pour imprimer l’entreprise, l’adresse, l’IDE et l’IBAN.",
    "Al massimo due righe, in fondo a ogni pagina. Lasci vuoto per stampare azienda, indirizzo, IDI e IBAN.",
  ],
  ["QR-bill", "QR-Rechnung", "QR-facture", "QR-fattura"],
  ["Applies to every document.", "Gilt für alle Dokumente.", "S’applique à tous les documents.", "Vale per tutti i documenti."],
  ["Saved for all documents.", "Für alle Dokumente gespeichert.", "Enregistré pour tous les documents.", "Salvato per tutti i documenti."],
  ["Changes this account on every document.", "Ändert dieses Konto auf allen Dokumenten.", "Modifie ce compte sur tous les documents.", "Modifica questo conto su tutti i documenti."],
  ["Adds it to your bank accounts.", "Wird zu Ihren Bankkonten hinzugefügt.", "Il sera ajouté à vos comptes bancaires.", "Verrà aggiunto ai suoi conti bancari."],
  [
    "No bank account yet. Add the one your customers should pay into.",
    "Noch kein Bankkonto. Erfassen Sie das Konto, auf das Ihre Kunden zahlen sollen.",
    "Pas encore de compte bancaire. Ajoutez celui sur lequel vos clients doivent payer.",
    "Ancora nessun conto bancario. Aggiunga quello su cui i suoi clienti devono pagare.",
  ],
  ["Add a bank account to print the QR-bill.", "Erfassen Sie ein Bankkonto, damit die QR-Rechnung gedruckt wird.", "Ajoutez un compte bancaire pour imprimer la QR-facture.", "Aggiunga un conto bancario per stampare la QR-fattura."],
  ["The bank account needs a valid IBAN for the QR-bill.", "Für die QR-Rechnung braucht das Bankkonto eine gültige IBAN.", "Pour la QR-facture, le compte bancaire doit avoir un IBAN valide.", "Per la QR-fattura il conto bancario deve avere un IBAN valido."],
  [
    "Add your postcode and city to the letterhead for the QR-bill.",
    "Ergänzen Sie PLZ und Ort im Briefkopf, damit die QR-Rechnung gedruckt wird.",
    "Ajoutez le NPA et la localité dans l’en-tête pour la QR-facture.",
    "Aggiunga NPA e località nell’intestazione per la QR-fattura.",
  ],
  ["No logo", "Kein Logo", "Pas de logo", "Nessun logo"],
  ["Upload logo", "Logo hochladen", "Téléverser un logo", "Carica logo"],
  ["Replace logo", "Logo ersetzen", "Remplacer le logo", "Sostituisci logo"],
  ["Remove logo", "Logo entfernen", "Retirer le logo", "Rimuovi logo"],
  ["Logo saved.", "Logo gespeichert.", "Logo enregistré.", "Logo salvato."],
  ["Logo removed.", "Logo entfernt.", "Logo retiré.", "Logo rimosso."],
];
