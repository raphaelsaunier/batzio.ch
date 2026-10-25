import { N_ } from "@/lib/i18n";

/**
 * Guesses where money went (or came from) from a few words, so nobody has to
 * know that train tickets live on account 6200. Rules are ordered: first match wins.
 */
export interface Category {
  accountNumber: string;
  label: string;
  /** Input VAT code for purchases (null = no VAT, e.g. bank fees, insurance). */
  taxCode: string | null;
  emoji: string;
}

const RULES: [RegExp, Category][] = [
  [/\b(bank\s*(fee|charge)s?|spesen|kontoführung|account maintenance|frais bancaires?|gebühr|fee)\b/i, { accountNumber: "6940", label: N_("Bank fees"), taxCode: null, emoji: "🏦" }],
  [/\b(rent|miete|loyer|affitto|parking|parkplatz)\b/i, { accountNumber: "6000", label: N_("Rent"), taxCode: null, emoji: "🏠" }],
  [/\b(swisscom|sunrise|salt|upc|internet|phone|telefon|handy|mobile|post|porto|stamps?|briefmarken)\b/i, { accountNumber: "6510", label: N_("Phone, internet & postage"), taxCode: "VI81", emoji: "📡" }],
  [/\b(sbb|cff|ffs|train|zug|tram|bus|taxi|uber|flight|flug|ticket|halbtax|ga\b|fuel|benzin|diesel|tank|car|auto|garage|parking)\b/i, { accountNumber: "6200", label: N_("Travel & vehicles"), taxCode: "VI81", emoji: "🚆" }],
  [/\b(google|microsoft|adobe|github|aws|cloud|hosting|domain|software|saas|license|lizenz|notion|figma|slack|openai|anthropic|apple|laptop|computer|monitor|it\b)\b/i, { accountNumber: "6570", label: N_("IT & software"), taxCode: "VI81", emoji: "💻" }],
  [/\b(insurance|versicherung|assurance|assicurazione|suva|mobiliar|axa|zurich insurance|helvetia|baloise)\b/i, { accountNumber: "6300", label: N_("Insurance & fees"), taxCode: null, emoji: "🛡️" }],
  [/\b(ads?|advert|werbung|publicité|marketing|linkedin|facebook|instagram|flyer|print)\b/i, { accountNumber: "6600", label: N_("Marketing"), taxCode: "VI81", emoji: "📣" }],
  [/\b(lunch|dinner|coffee|kaffee|café|restaurant|apéro|apero|meal|essen|repas|pizza|gipfeli)\b/i, { accountNumber: "6700", label: N_("Meals & hospitality"), taxCode: "VI81", emoji: "☕" }],
  [/\b(office|büro|bureau|paper|papier|toner|stationery|furniture|möbel|supplies)\b/i, { accountNumber: "6500", label: N_("Office"), taxCode: "VI81", emoji: "📎" }],
  [/\b(accountant|treuhand|fiduciaire|lawyer|anwalt|notary|notar|consulting fee|beratung)\b/i, { accountNumber: "6530", label: N_("Advisors"), taxCode: "VI81", emoji: "🧑‍⚖️" }],
  [/\b(electricity|strom|énergie|energy|heating|heizung|water|wasser)\b/i, { accountNumber: "6400", label: N_("Energy"), taxCode: "VI81", emoji: "⚡" }],
  [/\b(training|course|kurs|formation|conference|konferenz|books?|bücher)\b/i, { accountNumber: "5800", label: N_("Training & staff"), taxCode: "VI81", emoji: "📚" }],
  [/\b(ahv|avs|ausgleichskasse|caisse de compensation|bvg|pension)\b/i, { accountNumber: "2270", label: N_("Social insurances"), taxCode: null, emoji: "🧾" }],
  [/\b(tax|steuer|impôt|imposte)\b/i, { accountNumber: "8900", label: N_("Taxes"), taxCode: null, emoji: "🏛️" }],
  [/\b(salary|lohn|salaire|stipendio)\b/i, { accountNumber: "5000", label: N_("Salaries"), taxCode: null, emoji: "👥" }],
];

const FALLBACK_OUT: Category = { accountNumber: "6700", label: N_("Other expenses"), taxCode: "VI81", emoji: "🧺" };
const FALLBACK_IN: Category = { accountNumber: "3600", label: N_("Other income"), taxCode: null, emoji: "💰" };
const INTEREST_IN: Category = { accountNumber: "6950", label: N_("Interest received"), taxCode: null, emoji: "🪙" };

export function categorize(text: string, direction: "in" | "out" = "out"): Category {
  if (direction === "in") return /\b(zins|interest|intérêt|interesse)\b/i.test(text) ? INTEREST_IN : FALLBACK_IN;
  for (const [re, cat] of RULES) if (re.test(text)) return cat;
  return FALLBACK_OUT;
}

/** Lowercase, accent-free, punctuation-free text for fuzzy comparisons. */
export function normalize(s: string): string {
  return s
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(ag|gmbh|sa|sàrl|sarl|ltd|inc|llc|kg|co)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** 0…1 similarity between a query and a candidate name (prefix and token overlap). */
export function similarity(query: string, candidate: string): number {
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.startsWith(q) || q.startsWith(c)) return 0.92;
  if (c.includes(q)) return 0.85;
  const qt = q.split(" ");
  const ct = c.split(" ");
  const hits = qt.filter((t) => ct.some((x) => x.startsWith(t) || t.startsWith(x))).length;
  return (hits / Math.max(qt.length, 1)) * 0.8;
}

export function bestMatch<T>(query: string, items: T[], name: (t: T) => string, threshold = 0.5): T | null {
  let best: T | null = null;
  let score = threshold;
  for (const item of items) {
    const s = similarity(query, name(item));
    if (s > score) {
      score = s;
      best = item;
    }
  }
  return best;
}
