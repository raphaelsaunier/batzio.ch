"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Coin } from "./coin";

/**
 * The landing hero: the coin lands, then the tagline — the page's heading —
 * arrives, gets struck through and is corrected: “Accounting Suite” →
 * “Accounting, Sweet!”.
 */
export function CoinHero({ suite, sweet }: { suite: string; sweet: string }) {
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
      <h1 lang="en" className="coin-tagline font-display mt-14 text-5xl leading-[1.05] font-bold tracking-tight sm:text-7xl" data-phase={phase} aria-label={sweet}>
        <span className="coin-tagline-suite text-muted-foreground" aria-hidden>
          {suite}
          <span className="coin-tagline-strike" />
        </span>
        <span className="coin-tagline-sweet text-metal pb-1" aria-hidden>
          {sweet}
        </span>
      </h1>
    </div>
  );
}
