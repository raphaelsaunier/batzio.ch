import { Fragment } from "react";

/**
 * Just enough Markdown for chat replies: paragraphs, bullet and numbered
 * lists, **bold**, *italic*, `code` and [links](/relative). Builds React
 * nodes — never injects HTML.
 */
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const k = `${key}-${i++}`;
    if (token.startsWith("**")) out.push(<strong key={k}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={k} className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token) ?? [];
      const safe = href && (href.startsWith("/") || href.startsWith("https://"));
      out.push(
        safe ? (
          <a key={k} href={href} className="text-primary font-medium underline underline-offset-2" {...(href.startsWith("https://") ? { target: "_blank", rel: "noreferrer" } : {})}>
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else out.push(<em key={k}>{token.slice(1, -1)}</em>);
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((block, b) => {
        const lines = block.split("\n");
        const bullet = lines.every((l) => /^\s*[-*•]\s+/.test(l));
        const numbered = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
        if (bullet || numbered) {
          const List = numbered ? "ol" : "ul";
          return (
            <List key={b} className={numbered ? "my-1.5 ml-5 list-decimal space-y-0.5" : "my-1.5 ml-5 list-disc space-y-0.5"}>
              {lines.map((l, i) => (
                <li key={i}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""), `${b}-${i}`)}</li>
              ))}
            </List>
          );
        }
        return (
          <p key={b} className="my-1.5 first:mt-0 last:mb-0">
            {lines.map((l, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {inline(l.replace(/^#{1,6}\s+/, ""), `${b}-${i}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
