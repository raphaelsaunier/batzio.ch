"use client";

import { useEffect, useRef, useState } from "react";

const fmt = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Animates a money amount (in cents) from zero to its value. */
export function CountUp({ cents, prefix = "", duration = 900, className }: { cents: number; prefix?: string; duration?: number; className?: string }) {
  const [value, setValue] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) {
      setValue(cents);
      return;
    }
    started.current = true;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setValue(cents);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(cents * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cents, duration]);
  return (
    <span className={className}>
      {prefix}
      {fmt.format(value / 100)}
    </span>
  );
}
