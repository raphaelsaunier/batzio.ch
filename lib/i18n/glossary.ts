import type { Locale } from "./index";

/**
 * Plain-language explanations for accounting jargon, shown as tooltips next to
 * field labels, report lines and anywhere a <Term> is used. `match` lists the
 * English labels (lowercase) that should pick up the explanation.
 */
interface Entry {
  match: string[];
  en: [string, string];
  de: [string, string];
  fr: [string, string];
  it: [string, string];
}

export const GLOSSARY: Record<string, Entry> = {
  vat: {
    match: ["vat", "vat code", "tax", "tax code", "vat rate", "taxes"],
    en: ["VAT", "Value added tax. You add it to what you sell, collect it, and hand it to the federal tax administration — minus the VAT you paid on purchases."],
    de: ["MWST", "Mehrwertsteuer. Sie schlagen sie auf Ihre Verkäufe auf, kassieren sie und liefern sie der ESTV ab – abzüglich der MWST, die Sie selbst bezahlt haben."],
    fr: ["TVA", "Taxe sur la valeur ajoutée. Vous l’ajoutez à vos ventes, l’encaissez et la reversez à l’AFC – moins la TVA payée sur vos achats."],
    it: ["IVA", "Imposta sul valore aggiunto. La aggiunge alle vendite, la incassa e la versa all’AFC – meno l’IVA pagata sugli acquisti."],
  },
  input_tax: {
    match: ["input tax", "input vat", "purchase tax"],
    en: ["Input tax", "VAT you paid to suppliers. You can deduct it from the VAT you owe."],
    de: ["Vorsteuer", "Die MWST, die Sie Lieferanten bezahlt haben. Sie dürfen sie von Ihrer MWST-Schuld abziehen."],
    fr: ["Impôt préalable", "La TVA payée à vos fournisseurs. Vous pouvez la déduire de la TVA due."],
    it: ["Imposta precedente", "L’IVA pagata ai fornitori. Può dedurla dall’IVA dovuta."],
  },
  output_tax: {
    match: ["output tax", "output vat", "sales tax"],
    en: ["Output tax", "VAT you charged your customers. It was never really yours — it goes to the tax office."],
    de: ["Umsatzsteuer", "Die MWST, die Sie Kunden verrechnet haben. Sie gehört nie wirklich Ihnen – sie geht an die ESTV."],
    fr: ["TVA due", "La TVA facturée à vos clients. Elle ne vous a jamais vraiment appartenu – elle va à l’AFC."],
    it: ["IVA dovuta", "L’IVA fatturata ai clienti. Non è mai stata davvero sua – va all’AFC."],
  },
  vat_number: {
    match: ["vat number", "uid", "vat id", "uid number"],
    en: ["VAT number", "Your company ID (CHE-123.456.789) followed by MWST/TVA/IVA. It must be on your invoices once you are VAT-registered."],
    de: ["MWST-Nummer", "Ihre UID (CHE-123.456.789) mit dem Zusatz MWST. Gehört auf jede Rechnung, sobald Sie MWST-pflichtig sind."],
    fr: ["Numéro TVA", "Votre IDE (CHE-123.456.789) suivi de TVA. Obligatoire sur les factures dès l’assujettissement."],
    it: ["Numero IVA", "Il suo IDI (CHE-123.456.789) seguito da IVA. Obbligatorio sulle fatture se è assoggettato."],
  },
  vat_method: {
    match: ["vat method", "settlement method", "vat settlement"],
    en: ["VAT method", "Effective: you pay the VAT you collected minus the VAT you paid. Net tax rate: you pay a fixed percentage of revenue for your industry — simpler, but no input tax."],
    de: ["Abrechnungsmethode", "Effektiv: eingenommene MWST minus bezahlte Vorsteuer. Saldosteuersatz: ein fixer Branchen-Prozentsatz vom Umsatz – einfacher, dafür ohne Vorsteuerabzug."],
    fr: ["Méthode de décompte", "Effective : TVA encaissée moins impôt préalable. Taux de la dette fiscale nette : un pourcentage fixe du chiffre d’affaires selon la branche – plus simple, sans impôt préalable."],
    it: ["Metodo di rendiconto", "Effettivo: IVA incassata meno imposta precedente. Aliquota saldo: una percentuale fissa del fatturato secondo il settore – più semplice, senza imposta precedente."],
  },
  net_tax_rate: {
    match: ["net tax rate", "saldo tax rate", "flat rate", "flat tax rate"],
    en: ["Net tax rate", "A fixed VAT percentage for your industry, applied to gross revenue. You skip the input tax bookkeeping entirely."],
    de: ["Saldosteuersatz", "Ein fixer MWST-Satz für Ihre Branche, angewendet auf den Bruttoumsatz. Die Vorsteuer-Buchhaltung entfällt."],
    fr: ["Taux de la dette fiscale nette", "Un taux fixe selon votre branche, appliqué au chiffre d’affaires TTC. Plus besoin de suivre l’impôt préalable."],
    it: ["Aliquota saldo", "Un’aliquota fissa per il suo settore, applicata al fatturato lordo. Niente contabilità dell’imposta precedente."],
  },
  vat_return: {
    match: ["vat return", "vat report", "vat period", "vat settlement report"],
    en: ["VAT return", "The form (usually every quarter) where you tell the tax office how much VAT you collected and paid. Batzio fills in the boxes."],
    de: ["MWST-Abrechnung", "Das Formular (meist quartalsweise), auf dem Sie der ESTV melden, wie viel MWST Sie eingenommen und bezahlt haben. Batzio füllt die Ziffern aus."],
    fr: ["Décompte TVA", "Le formulaire (souvent trimestriel) où vous déclarez la TVA encaissée et payée. Batzio remplit les chiffres."],
    it: ["Rendiconto IVA", "Il modulo (di solito trimestrale) in cui dichiara l’IVA incassata e pagata. Batzio compila le cifre."],
  },
  vat_digit: {
    match: ["digit", "vat digit", "form digit", "digits"],
    en: ["Form digit", "Box numbers on the official VAT form, e.g. 200 = total revenue, 400 = input tax on purchases."],
    de: ["Ziffer", "Feldnummern im offiziellen MWST-Formular, z. B. 200 = Gesamtumsatz, 400 = Vorsteuer auf Aufwand."],
    fr: ["Chiffre", "Numéros de case du formulaire officiel, p. ex. 200 = chiffre d’affaires total, 400 = impôt préalable."],
    it: ["Cifra", "Numeri delle caselle del modulo ufficiale, p. es. 200 = fatturato totale, 400 = imposta precedente."],
  },
  reverse_charge: {
    match: ["reverse charge", "acquisition tax"],
    en: ["Reverse charge", "VAT you owe yourself on services bought from abroad — think software subscriptions billed from Ireland."],
    de: ["Bezugsteuer", "MWST, die Sie auf Dienstleistungen aus dem Ausland selbst abrechnen – etwa Software-Abos aus Irland."],
    fr: ["Impôt sur les acquisitions", "TVA que vous déclarez vous-même sur des prestations venues de l’étranger – un abonnement logiciel facturé depuis l’Irlande, par exemple."],
    it: ["Imposta sull’acquisto", "IVA che dichiara lei stesso su servizi acquistati all’estero – ad esempio abbonamenti software fatturati dall’Irlanda."],
  },
  debit: {
    match: ["debit", "debit account", "debits"],
    en: ["Debit", "The left side of an entry. For assets and expenses, debit means “more”. Nobody finds this intuitive — that’s fine."],
    de: ["Soll", "Die linke Seite einer Buchung. Bei Aktiven und Aufwand heisst Soll «mehr». Niemand findet das intuitiv – das ist okay."],
    fr: ["Débit", "Le côté gauche d’une écriture. Pour les actifs et les charges, débit veut dire « plus ». Personne ne trouve ça intuitif – c’est normal."],
    it: ["Dare", "Il lato sinistro di una registrazione. Per attivi e costi, dare significa «di più». Nessuno lo trova intuitivo – va bene così."],
  },
  credit: {
    match: ["credit", "credit account", "credits"],
    en: ["Credit", "The right side of an entry. For liabilities, equity and income, credit means “more”."],
    de: ["Haben", "Die rechte Seite einer Buchung. Bei Fremd- und Eigenkapital sowie Ertrag heisst Haben «mehr»."],
    fr: ["Crédit", "Le côté droit d’une écriture. Pour les dettes, les fonds propres et les produits, crédit veut dire « plus »."],
    it: ["Avere", "Il lato destro di una registrazione. Per passivi, capitale proprio e ricavi, avere significa «di più»."],
  },
  journal_entry: {
    match: ["journal entry", "journal entries", "entry", "posting", "postings", "manual entry"],
    en: ["Journal entry", "A record that money moved from one account to another. Every entry balances: debit equals credit."],
    de: ["Buchung", "Ein Eintrag, dass Geld von einem Konto auf ein anderes geflossen ist. Jede Buchung geht auf: Soll gleich Haben."],
    fr: ["Écriture", "La trace d’un mouvement d’argent d’un compte à l’autre. Toujours équilibrée : débit = crédit."],
    it: ["Registrazione", "La traccia di un movimento da un conto all’altro. Sempre in equilibrio: dare = avere."],
  },
  journal: {
    match: ["journal"],
    en: ["Journal", "All entries in date order — the diary of your business."],
    de: ["Journal", "Alle Buchungen in zeitlicher Reihenfolge – das Tagebuch Ihrer Firma."],
    fr: ["Journal", "Toutes les écritures par date – le journal intime de votre entreprise."],
    it: ["Giornale", "Tutte le registrazioni in ordine di data – il diario della sua azienda."],
  },
  ledger: {
    match: ["ledger", "general ledger", "account ledger", "account statement"],
    en: ["Ledger", "All entries grouped by account, with a running balance. Where you look when a number seems off."],
    de: ["Kontoblatt", "Alle Buchungen pro Konto mit laufendem Saldo. Da schaut man nach, wenn eine Zahl komisch aussieht."],
    fr: ["Grand livre", "Toutes les écritures par compte, avec le solde courant. Là où l’on regarde quand un chiffre paraît bizarre."],
    it: ["Partitario", "Tutte le registrazioni per conto con il saldo progressivo. Dove guardare quando un numero sembra strano."],
  },
  chart_of_accounts: {
    match: ["chart of accounts", "accounts"],
    en: ["Chart of accounts", "The list of all accounts. Batzio uses the Swiss SME chart (KMU), so your fiduciary will feel right at home."],
    de: ["Kontenplan", "Die Liste aller Konten. Batzio nutzt den Schweizer KMU-Kontenrahmen – Ihr Treuhänder fühlt sich sofort zuhause."],
    fr: ["Plan comptable", "La liste de tous les comptes. Batzio suit le plan comptable PME suisse – votre fiduciaire s’y retrouvera tout de suite."],
    it: ["Piano dei conti", "L’elenco di tutti i conti. Batzio usa il piano contabile PMI svizzero – il suo fiduciario si sentirà a casa."],
  },
  account: {
    match: ["account", "account number", "booking account", "revenue account", "expense account"],
    en: ["Account", "A bucket for one kind of money, e.g. 1020 Bank or 6000 Rent. The number tells accountants what kind of bucket it is."],
    de: ["Konto", "Ein Topf für eine Art Geld, z. B. 1020 Bank oder 6000 Miete. Die Nummer verrät Buchhaltern, was für ein Topf es ist."],
    fr: ["Compte", "Un tiroir pour un type d’argent, p. ex. 1020 Banque ou 6000 Loyer. Le numéro indique aux comptables de quel tiroir il s’agit."],
    it: ["Conto", "Un cassetto per un tipo di denaro, p. es. 1020 Banca o 6000 Affitto. Il numero dice ai contabili di che cassetto si tratta."],
  },
  trial_balance: {
    match: ["trial balance"],
    en: ["Trial balance", "Every account with its debits, credits and balance. If both columns match, the books add up."],
    de: ["Saldenliste", "Alle Konten mit Soll, Haben und Saldo. Stimmen beide Spalten überein, geht die Buchhaltung auf."],
    fr: ["Balance des comptes", "Chaque compte avec débits, crédits et solde. Si les deux colonnes concordent, la comptabilité est juste."],
    it: ["Bilancio di verifica", "Ogni conto con dare, avere e saldo. Se le due colonne coincidono, i conti tornano."],
  },
  balance_sheet: {
    match: ["balance sheet"],
    en: ["Balance sheet", "A snapshot of what the company owns (assets) and how that is financed (debts and equity) on one specific day."],
    de: ["Bilanz", "Eine Momentaufnahme: was die Firma besitzt (Aktiven) und wie das finanziert ist (Fremd- und Eigenkapital) – an einem Stichtag."],
    fr: ["Bilan", "Une photo à une date donnée : ce que l’entreprise possède (actifs) et comment c’est financé (dettes et fonds propres)."],
    it: ["Bilancio", "Una fotografia a una data precisa: cosa possiede l’azienda (attivi) e come è finanziato (debiti e capitale proprio)."],
  },
  income_statement: {
    match: ["income statement", "profit and loss", "p&l", "profit & loss"],
    en: ["Income statement", "Income minus expenses over a period. The bottom line is your profit — or your loss."],
    de: ["Erfolgsrechnung", "Ertrag minus Aufwand über eine Periode. Die letzte Zeile ist Ihr Gewinn – oder Verlust."],
    fr: ["Compte de résultat", "Produits moins charges sur une période. La dernière ligne : votre bénéfice – ou votre perte."],
    it: ["Conto economico", "Ricavi meno costi in un periodo. L’ultima riga è il suo utile – o la perdita."],
  },
  assets: {
    match: ["assets", "asset", "current assets"],
    en: ["Assets", "Everything the company owns: cash, bank balances, money customers owe you, equipment."],
    de: ["Aktiven", "Alles, was der Firma gehört: Kasse, Bank, Guthaben bei Kunden, Einrichtung."],
    fr: ["Actifs", "Tout ce que l’entreprise possède : caisse, banque, créances clients, équipement."],
    it: ["Attivi", "Tutto ciò che l’azienda possiede: cassa, banca, crediti verso clienti, attrezzature."],
  },
  liabilities: {
    match: ["liabilities", "liability", "debt"],
    en: ["Liabilities", "What the company owes others: suppliers, the tax office, the bank."],
    de: ["Fremdkapital", "Was die Firma anderen schuldet: Lieferanten, Steuerverwaltung, Bank."],
    fr: ["Fonds étrangers", "Ce que l’entreprise doit à d’autres : fournisseurs, fisc, banque."],
    it: ["Capitale di terzi", "Ciò che l’azienda deve ad altri: fornitori, fisco, banca."],
  },
  equity: {
    match: ["equity", "share capital"],
    en: ["Equity", "What belongs to the owners: the capital they put in plus the profits left in the company."],
    de: ["Eigenkapital", "Was den Eigentümern gehört: das einbezahlte Kapital plus die in der Firma gelassenen Gewinne."],
    fr: ["Fonds propres", "Ce qui appartient aux propriétaires : le capital apporté plus les bénéfices laissés dans l’entreprise."],
    it: ["Capitale proprio", "Ciò che appartiene ai proprietari: il capitale versato più gli utili lasciati in azienda."],
  },
  receivables: {
    match: ["receivables", "accounts receivable", "debtors", "open receivables", "receivable"],
    en: ["Receivables", "Money customers still owe you for invoices you’ve sent."],
    de: ["Debitoren", "Geld, das Kunden Ihnen für verschickte Rechnungen noch schulden."],
    fr: ["Débiteurs", "L’argent que vos clients vous doivent encore pour les factures envoyées."],
    it: ["Debitori", "Il denaro che i clienti le devono ancora per le fatture inviate."],
  },
  payables: {
    match: ["payables", "accounts payable", "creditors", "open payables", "payable"],
    en: ["Payables", "Money you still owe suppliers for bills you’ve received."],
    de: ["Kreditoren", "Geld, das Sie Lieferanten für erhaltene Rechnungen noch schulden."],
    fr: ["Créanciers", "L’argent que vous devez encore à vos fournisseurs."],
    it: ["Creditori", "Il denaro che deve ancora ai fornitori per le fatture ricevute."],
  },
  business_year: {
    match: ["business year", "business years", "fiscal year", "financial year"],
    en: ["Fiscal year", "The 12 months your books cover — usually the calendar year."],
    de: ["Geschäftsjahr", "Die 12 Monate, die Ihre Buchhaltung abdeckt – meist das Kalenderjahr."],
    fr: ["Exercice", "Les 12 mois couverts par votre comptabilité – en général l’année civile."],
    it: ["Esercizio", "I 12 mesi coperti dalla contabilità – di solito l’anno civile."],
  },
  closing: {
    match: ["close year", "year-end closing", "closing", "close business year", "closing entry"],
    en: ["Year-end closing", "Locking a fiscal year: profit or loss moves into equity and balances carry over into the new year."],
    de: ["Jahresabschluss", "Ein Geschäftsjahr abschliessen: Gewinn oder Verlust wandert ins Eigenkapital, die Salden ins neue Jahr."],
    fr: ["Clôture", "Boucler un exercice : le résultat passe dans les fonds propres et les soldes sont reportés sur la nouvelle année."],
    it: ["Chiusura", "Chiudere un esercizio: l’utile o la perdita va nel capitale proprio e i saldi passano al nuovo anno."],
  },
  opening_balance: {
    match: ["opening balance", "opening balances", "opening"],
    en: ["Opening balance", "What each account held on day one — handy when you move to Batzio mid-life. Drop last year’s balance list and it’s booked."],
    de: ["Eröffnungssaldo", "Was jedes Konto am ersten Tag enthielt – praktisch beim Umstieg. Saldenliste vom Vorjahr reinziehen, fertig."],
    fr: ["Solde d’ouverture", "Le contenu de chaque compte au premier jour – pratique quand on change de logiciel. Déposez la balance de l’an passé, c’est comptabilisé."],
    it: ["Saldo d’apertura", "Il contenuto di ogni conto il primo giorno – utile quando si cambia software. Trascini il bilancio dell’anno scorso ed è registrato."],
  },
  depreciation: {
    match: ["depreciation", "depreciations", "depreciate"],
    en: ["Depreciation", "Spreading the cost of something long-lived (a laptop, a van) over the years you use it."],
    de: ["Abschreibung", "Die Kosten von etwas Langlebigem (Laptop, Lieferwagen) auf die Jahre der Nutzung verteilen."],
    fr: ["Amortissement", "Répartir le coût d’un bien durable (ordinateur, camionnette) sur ses années d’utilisation."],
    it: ["Ammortamento", "Ripartire il costo di un bene durevole (portatile, furgone) sugli anni di utilizzo."],
  },
  fixed_asset: {
    match: ["fixed asset", "fixed assets"],
    en: ["Fixed asset", "Something you buy to use for years rather than to sell."],
    de: ["Anlagevermögen", "Etwas, das Sie kaufen, um es jahrelang zu nutzen – nicht, um es zu verkaufen."],
    fr: ["Immobilisation", "Un bien acheté pour être utilisé pendant des années, pas pour être revendu."],
    it: ["Immobilizzazione", "Un bene acquistato per usarlo per anni, non per rivenderlo."],
  },
  qr_bill: {
    match: ["qr-bill", "qr bill", "qr invoice"],
    en: ["QR-bill", "The Swiss payment slip with a QR code. Customers scan it in their banking app and the payment comes back with your reference."],
    de: ["QR-Rechnung", "Der Schweizer Einzahlungsschein mit QR-Code. Kunden scannen ihn im E-Banking – die Zahlung kommt mit Ihrer Referenz zurück."],
    fr: ["QR-facture", "Le bulletin de versement suisse avec code QR. Le client le scanne dans son e-banking et le paiement revient avec votre référence."],
    it: ["QR-fattura", "La polizza di versamento svizzera con codice QR. Il cliente la scansiona nell’e-banking e il pagamento torna con il suo riferimento."],
  },
  qr_iban: {
    match: ["qr-iban", "qr iban"],
    en: ["QR-IBAN", "A special IBAN (bank number 30000–31999) for QR-bills with a QR reference, so incoming payments match themselves."],
    de: ["QR-IBAN", "Eine spezielle IBAN (Institut 30000–31999) für QR-Rechnungen mit QR-Referenz – Zahlungen ordnen sich so von selbst zu."],
    fr: ["QR-IBAN", "Un IBAN spécial (institut 30000–31999) pour les QR-factures avec référence QR : les paiements se rapprochent tout seuls."],
    it: ["QR-IBAN", "Un IBAN speciale (istituto 30000–31999) per QR-fatture con riferimento QR: i pagamenti si abbinano da soli."],
  },
  qr_reference: {
    match: ["qr reference", "reference", "payment reference", "creditor reference", "esr reference"],
    en: ["Payment reference", "A number printed on the QR-bill that tells us exactly which invoice was paid. 27 digits for QR references, RF… for creditor references."],
    de: ["Zahlungsreferenz", "Eine Nummer auf der QR-Rechnung, die genau sagt, welche Rechnung bezahlt wurde. 27 Ziffern bei QR-Referenz, RF… bei Creditor Reference."],
    fr: ["Référence de paiement", "Un numéro sur la QR-facture qui indique exactement quelle facture a été payée. 27 chiffres pour la référence QR, RF… pour la Creditor Reference."],
    it: ["Riferimento di pagamento", "Un numero sulla QR-fattura che indica esattamente quale fattura è stata pagata. 27 cifre per il riferimento QR, RF… per la Creditor Reference."],
  },
  iban: {
    match: ["iban"],
    en: ["IBAN", "International bank account number. Swiss ones start with CH and have 21 characters."],
    de: ["IBAN", "Internationale Kontonummer. Schweizer IBAN beginnen mit CH und haben 21 Zeichen."],
    fr: ["IBAN", "Numéro de compte international. En Suisse il commence par CH et compte 21 caractères."],
    it: ["IBAN", "Numero di conto internazionale. In Svizzera inizia con CH e ha 21 caratteri."],
  },
  camt: {
    match: ["camt", "camt.053", "camt.054", "bank statement", "statement file", "statement"],
    en: ["Bank statement file", "The camt.053/054 file your e-banking exports. Drop it here and every line gets matched to invoices and bills."],
    de: ["Kontoauszugsdatei", "Die camt.053/054-Datei aus Ihrem E-Banking. Hier reinziehen – jede Zeile wird Rechnungen und Belegen zugeordnet."],
    fr: ["Fichier de relevé", "Le fichier camt.053/054 exporté par votre e-banking. Déposez-le ici et chaque ligne est rapprochée des factures."],
    it: ["File dell’estratto", "Il file camt.053/054 esportato dall’e-banking. Lo trascini qui e ogni riga viene abbinata a fatture e documenti."],
  },
  pain001: {
    match: ["pain.001", "payment file", "payment order file"],
    en: ["Payment file", "A pain.001 file containing all your outgoing payments. Upload it to e-banking once and everything is paid."],
    de: ["Zahlungsdatei", "Eine pain.001-Datei mit allen ausgehenden Zahlungen. Einmal ins E-Banking hochladen – alles bezahlt."],
    fr: ["Fichier de paiement", "Un fichier pain.001 avec tous vos paiements sortants. Un seul envoi dans l’e-banking et tout est payé."],
    it: ["File di pagamento", "Un file pain.001 con tutti i pagamenti in uscita. Un solo caricamento nell’e-banking e tutto è pagato."],
  },
  reminder: {
    match: ["reminder", "reminders", "dunning", "reminder level", "dunning level"],
    en: ["Reminder", "A note to a customer whose invoice is overdue. Up to three levels — friendly, firm, then serious."],
    de: ["Mahnung", "Eine Nachricht an Kunden mit überfälliger Rechnung. Bis zu drei Stufen – freundlich, bestimmt, ernst."],
    fr: ["Rappel", "Un message au client dont la facture est échue. Jusqu’à trois niveaux – aimable, ferme, puis sérieux."],
    it: ["Sollecito", "Un messaggio al cliente con fattura scaduta. Fino a tre livelli – gentile, deciso, poi serio."],
  },
  payment_terms: {
    match: ["payment terms", "payment term", "due date", "terms", "due in days"],
    en: ["Payment terms", "How long a customer has to pay, e.g. 30 days net. After that the invoice is late."],
    de: ["Zahlungsfrist", "Wie lange Kunden Zeit zum Zahlen haben, z. B. 30 Tage netto. Danach ist die Rechnung überfällig."],
    fr: ["Délai de paiement", "Le temps laissé au client pour payer, p. ex. 30 jours net. Ensuite la facture est en retard."],
    it: ["Termine di pagamento", "Il tempo concesso al cliente per pagare, p. es. 30 giorni netto. Poi la fattura è in ritardo."],
  },
  cash_discount: {
    match: ["cash discount", "early payment discount", "discount days", "discount percent"],
    en: ["Cash discount", "A small reward for paying early, e.g. 2% off within 10 days."],
    de: ["Skonto", "Eine kleine Belohnung fürs schnelle Zahlen, z. B. 2 % innert 10 Tagen."],
    fr: ["Escompte", "Une petite récompense pour un paiement rapide, p. ex. 2 % sous 10 jours."],
    it: ["Sconto", "Un piccolo premio per chi paga in fretta, p. es. 2 % entro 10 giorni."],
  },
  rounding: {
    match: ["rounding", "rounding difference", "round to 5 cents"],
    en: ["5-cent rounding", "Swiss totals are rounded to 0.05 because the smallest coin is 5 centimes."],
    de: ["Rappenrundung", "Schweizer Beträge werden auf 5 Rappen gerundet – die kleinste Münze."],
    fr: ["Arrondi à 5 centimes", "Les montants suisses sont arrondis à 0.05 – la plus petite pièce."],
    it: ["Arrotondamento a 5 centesimi", "Gli importi svizzeri si arrotondano a 0.05 – la moneta più piccola."],
  },
  net_gross: {
    match: ["net", "gross", "total net", "total gross", "taxes included", "prices include vat", "vat mode", "price mode", "subtotal"],
    en: ["Net & gross", "Net means before VAT, gross means VAT included. Customers pay gross."],
    de: ["Netto & brutto", "Netto heisst ohne MWST, brutto inklusive. Kunden zahlen brutto."],
    fr: ["HT & TTC", "HT = hors taxes, TTC = TVA comprise. Le client paie le TTC."],
    it: ["Netto & lordo", "Netto significa senza IVA, lordo IVA inclusa. Il cliente paga il lordo."],
  },
  credit_note: {
    match: ["credit note", "credit notes"],
    en: ["Credit note", "A negative invoice — for when you give money back to a customer."],
    de: ["Gutschrift", "Eine negative Rechnung – wenn Sie Kunden Geld zurückgeben."],
    fr: ["Note de crédit", "Une facture négative – quand vous remboursez un client."],
    it: ["Nota di credito", "Una fattura negativa – quando restituisce denaro a un cliente."],
  },
  delivery_note: {
    match: ["delivery note", "delivery notes", "delivery", "deliveries"],
    en: ["Delivery note", "Paperwork that travels with the goods. No prices needed."],
    de: ["Lieferschein", "Das Papier, das mit der Ware reist. Ohne Preise."],
    fr: ["Bulletin de livraison", "Le document qui accompagne la marchandise. Sans prix."],
    it: ["Bolletta di consegna", "Il documento che accompagna la merce. Senza prezzi."],
  },
  booked: {
    match: ["booked", "book", "booking date", "posted"],
    en: ["Booked", "Recorded in the ledger. From then on you change things with a reversal, not an eraser."],
    de: ["Verbucht", "In der Buchhaltung erfasst. Danach korrigiert man mit einer Stornobuchung, nicht mit dem Radiergummi."],
    fr: ["Comptabilisé", "Inscrit en comptabilité. Ensuite, on corrige par une extourne, pas avec une gomme."],
    it: ["Contabilizzato", "Registrato in contabilità. Da lì in poi si corregge con uno storno, non con la gomma."],
  },
  reversal: {
    match: ["reverse", "reversal", "storno", "reversed"],
    en: ["Reversal", "An entry that cancels another one. Accountants never erase — they reverse."],
    de: ["Storno", "Eine Buchung, die eine andere aufhebt. Buchhalter radieren nie – sie stornieren."],
    fr: ["Extourne", "Une écriture qui en annule une autre. Les comptables n’effacent jamais – ils extournent."],
    it: ["Storno", "Una registrazione che ne annulla un’altra. I contabili non cancellano mai – stornano."],
  },
  lock: {
    match: ["locked", "lock date", "period lock", "locked until", "books locked until"],
    en: ["Locked period", "Nothing dated before this day can change any more, so reports you’ve filed stay true."],
    de: ["Gesperrte Periode", "Nichts vor diesem Datum kann mehr geändert werden – eingereichte Abrechnungen bleiben korrekt."],
    fr: ["Période verrouillée", "Rien avant cette date ne peut plus changer : les décomptes déposés restent justes."],
    it: ["Periodo bloccato", "Nulla prima di questa data può più cambiare: i rendiconti inoltrati restano corretti."],
  },
  value_date: {
    match: ["value date", "valuta"],
    en: ["Value date", "The day the bank actually counts the money as moved — may differ from the booking date."],
    de: ["Valuta", "Der Tag, an dem die Bank das Geld tatsächlich als bewegt zählt – kann vom Buchungsdatum abweichen."],
    fr: ["Date de valeur", "Le jour où la banque considère l’argent comme réellement transféré – peut différer de la date de comptabilisation."],
    it: ["Data valuta", "Il giorno in cui la banca considera davvero trasferito il denaro – può differire dalla data di registrazione."],
  },
  liquidity: {
    match: ["liquidity", "cash", "cash flow", "liquidity forecast", "money weather"],
    en: ["Liquidity", "Money you can actually spend right now — bank and cash. Profit is an opinion, cash is a fact."],
    de: ["Liquidität", "Geld, über das Sie jetzt verfügen können – Bank und Kasse. Gewinn ist eine Meinung, Cash ist eine Tatsache."],
    fr: ["Liquidités", "L’argent réellement disponible – banque et caisse. Le bénéfice est une opinion, la trésorerie un fait."],
    it: ["Liquidità", "Il denaro davvero disponibile – banca e cassa. L’utile è un’opinione, la liquidità un fatto."],
  },
  revenue: {
    match: ["revenue", "turnover", "sales revenue", "income"],
    en: ["Revenue", "Everything you invoiced in a period, before any costs."],
    de: ["Umsatz", "Alles, was Sie in einer Periode verrechnet haben – vor Kosten."],
    fr: ["Chiffre d’affaires", "Tout ce que vous avez facturé sur une période, avant les charges."],
    it: ["Fatturato", "Tutto ciò che ha fatturato in un periodo, prima dei costi."],
  },
  profit: {
    match: ["profit", "result", "profit/loss", "annual result", "net income", "loss"],
    en: ["Profit", "Income minus expenses. The number everybody asks about at the end of the year."],
    de: ["Gewinn", "Ertrag minus Aufwand. Die Zahl, nach der am Jahresende alle fragen."],
    fr: ["Bénéfice", "Produits moins charges. Le chiffre que tout le monde demande en fin d’année."],
    it: ["Utile", "Ricavi meno costi. Il numero che tutti chiedono a fine anno."],
  },
  ahv: {
    match: ["ahv", "ahv/iv/eo", "ahv number", "social security number", "ahv rate"],
    en: ["AHV/IV/EO", "Old-age, disability and income-compensation insurance: 5.3% from the employee, 5.3% from the employer, on the whole salary."],
    de: ["AHV/IV/EO", "Alters-, Invaliden- und Erwerbsersatzversicherung: je 5.3 % von Arbeitnehmer und Arbeitgeber, auf dem ganzen Lohn."],
    fr: ["AVS/AI/APG", "Assurance vieillesse, invalidité et perte de gain : 5.3 % pour l’employé, 5.3 % pour l’employeur, sur tout le salaire."],
    it: ["AVS/AI/IPG", "Assicurazione vecchiaia, invalidità e perdita di guadagno: 5.3 % dal dipendente e 5.3 % dal datore, sull’intero salario."],
  },
  alv: {
    match: ["alv", "unemployment insurance", "alv rate"],
    en: ["Unemployment insurance (ALV)", "1.1% each from employee and employer, on salaries up to CHF 148’200 a year."],
    de: ["ALV", "Arbeitslosenversicherung: je 1.1 % von Arbeitnehmer und Arbeitgeber, bis CHF 148’200 Jahreslohn."],
    fr: ["AC", "Assurance chômage : 1.1 % chacun, employé et employeur, jusqu’à CHF 148’200 de salaire annuel."],
    it: ["AD", "Assicurazione contro la disoccupazione: 1.1 % ciascuno, fino a CHF 148’200 di salario annuo."],
  },
  bvg: {
    match: ["bvg", "pension fund", "occupational pension", "bvg rate", "pension"],
    en: ["Pension fund (BVG)", "The 2nd pillar. Mandatory above CHF 22’680 a year; the employer pays at least half."],
    de: ["Pensionskasse (BVG)", "Die 2. Säule. Obligatorisch ab CHF 22’680 Jahreslohn; der Arbeitgeber zahlt mindestens die Hälfte."],
    fr: ["Caisse de pension (LPP)", "Le 2e pilier. Obligatoire dès CHF 22’680 par an ; l’employeur paie au moins la moitié."],
    it: ["Cassa pensioni (LPP)", "Il 2° pilastro. Obbligatoria da CHF 22’680 all’anno; il datore paga almeno la metà."],
  },
  uvg: {
    match: ["uvg", "nbu", "accident insurance", "non-occupational accident", "nbu rate"],
    en: ["Accident insurance (UVG/NBU)", "Work accidents are on the employer; non-work accidents (NBU) are usually deducted from the salary."],
    de: ["Unfallversicherung (UVG/NBU)", "Berufsunfälle zahlt der Arbeitgeber; Nichtberufsunfälle (NBU) werden meist vom Lohn abgezogen."],
    fr: ["Assurance accidents (LAA/ANP)", "Les accidents professionnels sont à la charge de l’employeur ; les non professionnels (ANP) sont en général déduits du salaire."],
    it: ["Assicurazione infortuni (LAINF/INP)", "Gli infortuni professionali li paga il datore; quelli non professionali (INP) di solito si deducono dal salario."],
  },
  ktg: {
    match: ["ktg", "sickness insurance", "daily sickness allowance", "ktg rate"],
    en: ["Sickness insurance (KTG)", "Keeps paying salary when someone is ill for a long time. Optional, but most employers have it."],
    de: ["Krankentaggeld (KTG)", "Zahlt den Lohn weiter, wenn jemand lange krank ist. Freiwillig, aber fast alle haben es."],
    fr: ["Perte de gain maladie (IJM)", "Continue de verser le salaire en cas de longue maladie. Facultative, mais très répandue."],
    it: ["Indennità giornaliera di malattia (IGM)", "Continua a pagare il salario in caso di lunga malattia. Facoltativa, ma molto diffusa."],
  },
  withholding_tax: {
    match: ["withholding tax", "source tax", "withholding tax rate"],
    en: ["Withholding tax", "Income tax deducted straight from the salary of foreign employees without a C permit."],
    de: ["Quellensteuer", "Einkommenssteuer, die bei ausländischen Mitarbeitenden ohne C-Bewilligung direkt vom Lohn abgezogen wird."],
    fr: ["Impôt à la source", "Impôt sur le revenu prélevé directement sur le salaire des employés étrangers sans permis C."],
    it: ["Imposta alla fonte", "Imposta sul reddito trattenuta direttamente dal salario dei dipendenti stranieri senza permesso C."],
  },
  gross_salary: {
    match: ["gross salary", "monthly salary", "salary", "gross pay"],
    en: ["Gross salary", "The salary before any deductions. What’s in the contract."],
    de: ["Bruttolohn", "Der Lohn vor allen Abzügen. Das, was im Vertrag steht."],
    fr: ["Salaire brut", "Le salaire avant déductions. Ce qui figure dans le contrat."],
    it: ["Salario lordo", "Il salario prima delle deduzioni. Quello scritto nel contratto."],
  },
  net_salary: {
    match: ["net salary", "net pay", "payout"],
    en: ["Net salary", "What actually lands in the bank account after all deductions."],
    de: ["Nettolohn", "Was nach allen Abzügen wirklich auf dem Konto landet."],
    fr: ["Salaire net", "Ce qui arrive vraiment sur le compte après toutes les déductions."],
    it: ["Salario netto", "Ciò che arriva davvero sul conto dopo tutte le deduzioni."],
  },
  thirteenth: {
    match: ["13th salary", "thirteenth salary", "13th month"],
    en: ["13th salary", "A common Swiss extra month of pay, often split or paid in December."],
    de: ["13. Monatslohn", "Ein in der Schweiz üblicher Extra-Monatslohn, oft im Dezember oder aufgeteilt."],
    fr: ["13e salaire", "Un mois de salaire supplémentaire courant en Suisse, souvent versé en décembre."],
    it: ["13a mensilità", "Una mensilità extra comune in Svizzera, spesso pagata a dicembre."],
  },
  billable: {
    match: ["billable", "unbilled", "billable hours"],
    en: ["Billable", "Time you can charge a customer for. Unbilled billable time is money lying on the floor."],
    de: ["Verrechenbar", "Zeit, die Sie Kunden verrechnen können. Unverrechnete Zeit ist Geld, das herumliegt."],
    fr: ["Facturable", "Du temps que vous pouvez facturer. Du temps facturable non facturé, c’est de l’argent qui traîne."],
    it: ["Fatturabile", "Tempo che può fatturare al cliente. Tempo fatturabile non fatturato è denaro lasciato per terra."],
  },
  cost_center: {
    match: ["cost center", "cost centre", "cost centers"],
    en: ["Cost centre", "A label for where money is spent (a team, a site) so you can see costs per area."],
    de: ["Kostenstelle", "Eine Markierung, wo Geld ausgegeben wird (Team, Standort), um Kosten pro Bereich zu sehen."],
    fr: ["Centre de coûts", "Une étiquette indiquant où l’argent est dépensé (équipe, site) pour voir les coûts par domaine."],
    it: ["Centro di costo", "Un’etichetta per sapere dove si spende (team, sede) e vedere i costi per area."],
  },
};

const INDEX = new Map<string, string>();
for (const [id, entry] of Object.entries(GLOSSARY)) for (const m of entry.match) if (!INDEX.has(m)) INDEX.set(m, id);

/** Glossary id for an English label (or a glossary id itself). */
export function termFor(label: string | null | undefined): string | null {
  if (!label) return null;
  if (label in GLOSSARY) return label;
  const key = label.toLowerCase().replace(/\s*\(.*?\)\s*/g, "").replace(/[:*]/g, "").trim();
  return INDEX.get(key) ?? null;
}

export function explain(id: string, locale: Locale): { term: string; text: string } | null {
  const entry = GLOSSARY[id];
  if (!entry) return null;
  const [term, text] = entry[locale] ?? entry.en;
  return { term, text };
}
