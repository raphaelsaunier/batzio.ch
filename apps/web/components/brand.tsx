import { cn } from "@/lib/utils";

/** The Batzio coin, small. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <picture className={cn("inline-block size-8 shrink-0 rounded-full drop-shadow-[0_1px_2px_rgb(12_28_52/0.35)]", className)}>
      <source type="image/avif" srcSet="/brand/coin-front-160.avif" />
      <source type="image/webp" srcSet="/brand/coin-front-160.webp" />
      <img src="/brand/coin-front-160.png" alt="" width={160} height={160} className="size-full" />
    </picture>
  );
}

export function Brand({ className, tone = "default" }: { className?: string; tone?: "default" | "inverted" }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark />
      <span className={cn("font-brand text-xl leading-none font-bold tracking-[0.14em] uppercase", tone === "inverted" ? "text-white" : "text-metal")}>Batzio</span>
    </span>
  );
}
