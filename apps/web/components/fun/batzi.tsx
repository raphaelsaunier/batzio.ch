import { cn } from "@/lib/utils";

export type BatziMood = "happy" | "wink" | "sleepy" | "party" | "worried" | "cool" | "wave" | "thinking";

/**
 * Batzi — the Batzen coin who does your bookkeeping so you don't have to.
 * Pure SVG, safe in server components. Gradients use fixed ids: every instance
 * defines identical gradients, so sharing them on one page is harmless.
 */
export function Batzi({ mood = "happy", className, title }: { mood?: BatziMood; className?: string; title?: string }) {
  const eyes = (() => {
    switch (mood) {
      case "wink":
        return (
          <>
            <ellipse cx="50" cy="56" rx="4.2" ry="5.4" fill="#16263f" />
            <path d="M70 57c2.5-3 7-3 9.5 0" stroke="#16263f" strokeWidth="3.4" fill="none" strokeLinecap="round" />
          </>
        );
      case "sleepy":
        return (
          <>
            <path d="M44 58c2.5 2.6 7 2.6 9.5 0" stroke="#16263f" strokeWidth="3.4" fill="none" strokeLinecap="round" />
            <path d="M70 58c2.5 2.6 7 2.6 9.5 0" stroke="#16263f" strokeWidth="3.4" fill="none" strokeLinecap="round" />
          </>
        );
      case "cool":
        return (
          <>
            <path d="M38 52h48" stroke="#0e1a2e" strokeWidth="3" strokeLinecap="round" />
            <rect x="40" y="51" width="19" height="12" rx="5" fill="#0e1a2e" />
            <rect x="65" y="51" width="19" height="12" rx="5" fill="#0e1a2e" />
            <path d="M44 54l5 0" stroke="#7aa3cf" strokeWidth="2" strokeLinecap="round" />
            <path d="M69 54l5 0" stroke="#7aa3cf" strokeWidth="2" strokeLinecap="round" />
          </>
        );
      case "thinking":
        return (
          <>
            <ellipse cx="52" cy="54" rx="4" ry="5.2" fill="#16263f" />
            <ellipse cx="76" cy="54" rx="4" ry="5.2" fill="#16263f" />
            <circle cx="53.5" cy="52" r="1.3" fill="#fff" />
            <circle cx="77.5" cy="52" r="1.3" fill="#fff" />
          </>
        );
      default:
        return (
          <>
            <ellipse cx="49" cy="56" rx="4.2" ry="5.4" fill="#16263f" />
            <ellipse cx="75" cy="56" rx="4.2" ry="5.4" fill="#16263f" />
            <circle cx="50.5" cy="54" r="1.4" fill="#fff" />
            <circle cx="76.5" cy="54" r="1.4" fill="#fff" />
          </>
        );
    }
  })();

  const mouth = (() => {
    switch (mood) {
      case "party":
        return <path d="M52 67c2 8 18 8 20 0z" fill="#16263f" stroke="#16263f" strokeWidth="2" strokeLinejoin="round" />;
      case "worried":
        return <path d="M53 72c3-4 15-4 18 0" stroke="#16263f" strokeWidth="3.2" fill="none" strokeLinecap="round" />;
      case "sleepy":
        return <ellipse cx="62" cy="70" rx="3.2" ry="2.6" fill="#16263f" />;
      case "thinking":
        return <path d="M57 70h11" stroke="#16263f" strokeWidth="3.2" strokeLinecap="round" />;
      default:
        return <path d="M53 67c3 5 15 5 18 0" stroke="#16263f" strokeWidth="3.4" fill="none" strokeLinecap="round" />;
    }
  })();

  return (
    <svg viewBox="0 0 124 124" className={cn("size-16 shrink-0", className)} role="img" aria-label={title ?? `Batzi looks ${mood}`}>
      <defs>
        <linearGradient id="batzi-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b9d0ea" />
          <stop offset="0.45" stopColor="#3f6fa6" />
          <stop offset="1" stopColor="#21416b" />
        </linearGradient>
        <linearGradient id="batzi-face" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#e9f2fc" />
          <stop offset="0.5" stopColor="#a9c6e6" />
          <stop offset="1" stopColor="#6f98c8" />
        </linearGradient>
      </defs>
      {mood === "wave" && <path d="M101 66c8-4 12-12 11-20" stroke="#3f6fa6" strokeWidth="6" fill="none" strokeLinecap="round" />}
      {mood === "party" && (
        <g>
          <path d="M50 18l12-16 12 16z" fill="#f2c94c" stroke="#d9a62c" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="62" cy="3" r="3.5" fill="#e76f51" />
          <circle cx="20" cy="24" r="3" fill="#f2c94c" />
          <circle cx="104" cy="22" r="2.5" fill="#7aa3cf" />
          <path d="M14 46l6-3M108 44l6 2" stroke="#e76f51" strokeWidth="3" strokeLinecap="round" />
        </g>
      )}
      <circle cx="62" cy="64" r="46" fill="url(#batzi-rim)" />
      <circle cx="62" cy="64" r="39" fill="url(#batzi-face)" />
      <circle cx="62" cy="64" r="39" fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="2 4" />
      <path d="M33 44c6-11 18-18 30-18" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="4" fill="none" strokeLinecap="round" />
      {mood === "worried" && (
        <>
          <path d="M42 47l11-3" stroke="#16263f" strokeWidth="3" strokeLinecap="round" />
          <path d="M82 47l-11-3" stroke="#16263f" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {eyes}
      <ellipse cx="41" cy="67" rx="5.5" ry="3.4" fill="#f4a3a8" fillOpacity="0.75" />
      <ellipse cx="83" cy="67" rx="5.5" ry="3.4" fill="#f4a3a8" fillOpacity="0.75" />
      {mouth}
      {mood === "sleepy" && (
        <text x="92" y="30" fontSize="16" fontWeight="800" fill="#3f6fa6" fontFamily="system-ui">
          z<tspan fontSize="11" dy="-6">z</tspan>
        </text>
      )}
      {mood === "thinking" && (
        <g fill="#3f6fa6">
          <circle cx="98" cy="30" r="3" />
          <circle cx="106" cy="20" r="4.5" />
        </g>
      )}
    </svg>
  );
}
