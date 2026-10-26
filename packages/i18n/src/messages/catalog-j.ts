import type { CatalogRow } from "./catalog";

// Rows are [en, de, fr, it]: the native apps' on-device mode.
export const ROWS: CatalogRow[] = [
  ["On this device", "Auf diesem Gerät", "Sur cet appareil", "Su questo dispositivo"],
  [
    "Everything stays on this device: no account and no internet needed. Batzi, the assistant, needs a connection and is off here.",
    "Alles bleibt auf diesem Gerät: kein Konto und kein Internet nötig. Batzi, der Assistent, braucht eine Verbindung und ist hier aus.",
    "Tout reste sur cet appareil : ni compte ni internet nécessaires. Batzi, l’assistant, a besoin d’une connexion et est désactivé ici.",
    "Tutto resta su questo dispositivo: niente account né internet. Batzi, l’assistente, ha bisogno di una connessione ed è disattivato qui.",
  ],
  ["Start on this device", "Auf diesem Gerät starten", "Commencer sur cet appareil", "Inizia su questo dispositivo"],
  ["Continue on this device", "Auf diesem Gerät weitermachen", "Continuer sur cet appareil", "Continua su questo dispositivo"],
  ["Delete everything on this device…", "Alles auf diesem Gerät löschen…", "Tout supprimer sur cet appareil…", "Elimina tutto su questo dispositivo…"],
  [
    "This deletes every company, document and file stored on this device. It cannot be undone.",
    "Damit werden alle Firmen, Dokumente und Dateien auf diesem Gerät gelöscht. Das lässt sich nicht rückgängig machen.",
    "Toutes les entreprises, documents et fichiers enregistrés sur cet appareil seront supprimés. Cette action est irréversible.",
    "Verranno eliminati tutte le aziende, i documenti e i file salvati su questo dispositivo. L’operazione è irreversibile.",
  ],
  ["Delete everything", "Alles löschen", "Tout supprimer", "Elimina tutto"],
  ["Needs an internet connection", "Braucht eine Internetverbindung", "Nécessite une connexion internet", "Richiede una connessione internet"],
  [
    "Batzi needs an internet connection. On this device, quick sentences and file drops still work.",
    "Batzi braucht eine Internetverbindung. Auf diesem Gerät funktionieren Kurzsätze und Datei-Drops trotzdem.",
    "Batzi a besoin d’une connexion internet. Sur cet appareil, les phrases rapides et les dépôts de fichiers fonctionnent quand même.",
    "Batzi ha bisogno di una connessione internet. Su questo dispositivo le frasi rapide e i file trascinati funzionano comunque.",
  ],
  ["Show the folder", "Ordner zeigen", "Afficher le dossier", "Mostra la cartella"],
  ["Batzio could not start on this device.", "Batzio konnte auf diesem Gerät nicht starten.", "Batzio n’a pas pu démarrer sur cet appareil.", "Batzio non è riuscito ad avviarsi su questo dispositivo."],
  ["Use a server instead", "Stattdessen einen Server verwenden", "Utiliser plutôt un serveur", "Usa invece un server"],
];
