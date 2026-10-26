import type { CatalogRow } from "./catalog";

// Rows are [en, de, fr, it]. Add new strings to any catalog file; tests/i18n.test.ts lists what is missing.
export const ROWS: CatalogRow[] = [
  ["{label} archived.", "{label} archiviert.", "{label} archivé.", "{label} archiviato."],
  ["{label} created.", "{label} erstellt.", "{label} créé.", "{label} creato."],
  ["{label} deleted.", "{label} gelöscht.", "{label} supprimé.", "{label} eliminato."],
  ["{label} saved.", "{label} gespeichert.", "{label} enregistré.", "{label} salvato."],
  ["{n} record", "{n} Eintrag", "{n} entrée", "{n} voce"],
  ["{n} records", "{n} Einträge", "{n} entrées", "{n} voci"],
];
