"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Coin } from "./coin";

/**
 * The landing hero: the coin lands, then the tagline arrives, gets struck
 * through and is corrected — “Accounting Suite” → “Accounting, Sweet!”.
 */
export function CoinHero({ suite, sweet, hint }: { suite: string; sweet: string; hint: string }) {
  const [phase, setPhase] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const landed = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setPhase(3);
    setPhase(1);
    timers.current.push(setTimeout(() => setPhase(2), 1100), setTimeout(() => setPhase(3), 1750));
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return (
    <div className="flex flex-col items-center">
      <Coin onLanded={landed} />
      <p className="coin-tagline font-display mt-14 text-4xl font-bold tracking-tight sm:text-5xl" data-phase={phase} aria-label={sweet}>
        <span className="coin-tagline-suite text-muted-foreground" aria-hidden>
          {suite}
          <span className="coin-tagline-strike" />
        </span>
        <span className="coin-tagline-sweet text-metal pb-1" aria-hidden>
          {sweet}
        </span>
      </p>
      <p className={`text-muted-foreground mt-4 text-xs transition-opacity duration-700 ${phase === 3 ? "opacity-100" : "opacity-0"}`}>{hint}</p>
    </div>
  );
}
