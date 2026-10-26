"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The Batzio coin: two minted faces and a thick reeded edge built from lit
 * facets, tossed onto the page — a few turns, a drop, a little bounce, then
 * it lies flat with a soft contact shadow. Hover tilts it toward the
 * pointer; a click flips it.
 */
const FACETS = 60;
const LIGHT = -40; // light comes from the upper left (degrees around the rim, 0 = top)
const TOSS_MS = 2600;

type Frame = { spin: number; tilt: number; height: number; wobble: number };

const easeOutQuad = (x: number) => 1 - (1 - x) * (1 - x);
const deg = (d: number) => (d * Math.PI) / 180;

/** Physical-ish toss: falls while spinning down to rest, bounces once, wobbles flat. */
function tossFrame(t: number, turns: number): Frame {
  const land = 0.6;
  if (t < land) {
    const p = t / land;
    return { spin: 360 * turns * easeOutQuad(p), tilt: 16 * (1 - p), height: 1 - p * p, wobble: 0 };
  }
  const u = (t - land) / (1 - land);
  const bounce = u < 0.35 ? 0.1 * Math.sin((Math.PI * u) / 0.35) : 0;
  const wobble = 7 * Math.exp(-5 * u) * Math.sin(u * Math.PI * 5);
  return { spin: 360 * turns, tilt: 0, height: bounce, wobble };
}

function flipFrame(t: number, from: number): Frame {
  return { spin: from + 180 * easeOutQuad(t), tilt: 0, height: 0.18 * Math.sin(Math.PI * t), wobble: 3 * Math.sin(t * Math.PI * 2) * (1 - t) };
}

function coinTransform(f: Frame) {
  return `translateY(${(-f.height * 18).toFixed(2)}%) scale(${(1 + f.height * 0.32).toFixed(4)}) rotateX(${(f.tilt + f.wobble).toFixed(2)}deg) rotateY(${f.spin.toFixed(2)}deg)`;
}

/** The shadow lives on the page: it narrows when the coin is edge-on and softens with height. */
function shadowFrame(f: Frame) {
  const facing = Math.max(Math.abs(Math.cos(deg(f.spin))), 0.12);
  const sx = facing * (1 + f.height * 0.3);
  const sy = Math.max(Math.abs(Math.cos(deg(f.tilt + f.wobble))), 0.4) * (1 + f.height * 0.3);
  return {
    transform: `translate(${(f.height * 9).toFixed(2)}%, ${(4 + f.height * 22).toFixed(2)}%) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`,
    opacity: (0.55 - f.height * 0.35).toFixed(3),
    filter: `blur(${(6 + f.height * 26).toFixed(1)}px)`,
  };
}

/** A specular band that sweeps across the faces on every half-turn, resting off-face. */
function sheenFrame(f: Frame) {
  const half = (((f.spin % 180) + 180) % 180) / 180;
  return { backgroundPosition: `${(half * 100).toFixed(1)}% 0%`, opacity: (0.25 + 0.6 * Math.abs(Math.sin(deg(f.spin)))).toFixed(3) };
}

function frames(fn: (t: number) => Frame, steps = 96) {
  const coin: Keyframe[] = [];
  const shadow: Keyframe[] = [];
  const sheen: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const f = fn(i / steps);
    coin.push({ transform: coinTransform(f) });
    shadow.push(shadowFrame(f));
    sheen.push(sheenFrame(f));
  }
  return { coin, shadow, sheen };
}

function Face({ side, priority }: { side: "front" | "back"; priority?: boolean }) {
  const alt = side === "front" ? "Batzio coin: a Swiss guard with a calculator and a pen — “Batzio – Accounting Suite, Est. 2026”" : "Batzio coin, reverse: the Matterhorn above a lake, edelweiss and the Swiss cross";
  return (
    <div className={cn("coin-face", side === "back" && "coin-face-back")}>
      <picture>
        <source type="image/avif" srcSet={`/brand/coin-${side}-720.avif 720w, /brand/coin-${side}-160.avif 160w`} sizes="(max-width: 640px) 60vw, 340px" />
        <source type="image/webp" srcSet={`/brand/coin-${side}-720.webp 720w, /brand/coin-${side}-160.webp 160w`} sizes="(max-width: 640px) 60vw, 340px" />
        <img
          src={`/brand/coin-${side}-720.png`}
          alt={side === "front" ? alt : ""}
          aria-hidden={side === "back" || undefined}
          width={720}
          height={720}
          draggable={false}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
        />
      </picture>
      <div className="coin-glare" />
      <div className="coin-sheen" data-sheen />
    </div>
  );
}

export function Coin({ className, onLanded }: { className?: string; onLanded?: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const coin = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const angle = useRef(0);
  const busy = useRef(false);
  const landed = useRef(onLanded);
  landed.current = onLanded;

  const play = useCallback((fn: (t: number) => Frame, duration: number, end: number) => {
    const c = coin.current;
    const s = shadow.current;
    if (!c || !s) return Promise.resolve();
    busy.current = true;
    const f = frames(fn);
    const opts: KeyframeAnimationOptions = { duration, easing: "linear", fill: "forwards" };
    const sheens = Array.from(c.querySelectorAll<HTMLElement>("[data-sheen]"));
    const anims = [c.animate(f.coin, opts), s.animate(f.shadow, opts), ...sheens.map((el) => el.animate(f.sheen, opts))];
    return Promise.all(anims.map((a) => a.finished)).then(() => {
      angle.current = end;
      busy.current = false;
    });
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    el.dataset.ready = "true";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      landed.current?.();
      return;
    }
    const turns = 5;
    void play((t) => tossFrame(t, turns), TOSS_MS, 360 * turns).then(() => landed.current?.());
  }, [play]);

  // Tilt toward the pointer once the coin is at rest.
  const onPointerMove = (e: React.PointerEvent) => {
    if (busy.current || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    e.currentTarget.setAttribute("style", `--tilt-x:${(-y * 18).toFixed(2)}deg;--tilt-y:${(x * 18).toFixed(2)}deg;--glare-x:${(50 + x * 60).toFixed(1)}%;--glare-y:${(40 + y * 60).toFixed(1)}%`);
  };
  const onPointerLeave = (e: React.PointerEvent) => e.currentTarget.removeAttribute("style");
  const flip = () => {
    if (busy.current) return;
    stage.current?.removeAttribute("style");
    const from = angle.current;
    void play((t) => flipFrame(t, from), 900, from + 180);
  };

  return (
    <div
      ref={stage}
      className={cn("coin-stage", className)}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      onClick={flip}
      role="img"
      aria-label="Batzio"
    >
      <div ref={shadow} className="coin-shadow" />
      <div className="coin-tilt">
        <div ref={coin} className="coin">
          <Face side="front" priority />
          <Face side="back" />
          {Array.from({ length: FACETS }, (_, i) => {
            const theta = (360 / FACETS) * i;
            const light = Math.cos(deg(theta - LIGHT));
            return (
              <div
                key={i}
                className="coin-facet"
                style={{
                  transform: `rotateZ(${theta}deg) translateY(calc(var(--coin-size) / -2)) rotateX(90deg)`,
                  ["--facet-shade" as string]: (0.42 - light * 0.36).toFixed(3),
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
