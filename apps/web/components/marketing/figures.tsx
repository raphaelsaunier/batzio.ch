/** Money in running text: “CHF 1’827.95”, “CHF 35.–”, “45.–” — not dates (25.11.2026), rates (8.1 %) or counts (1’204). */
const MONEY = /(?<![\d.’'])(?:CHF\s)?\d{1,3}(?:[’']\d{3})*\.(?:\d{2}|–)(?!\d|\.\d)/g;

/** Text with every amount of money set semibold in tabular figures, in any of the four languages. */
export function Figures({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MONEY)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span key={m.index} className="num font-semibold whitespace-nowrap">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}
