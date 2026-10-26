import { AppWindow, Globe, Laptop, Smartphone, Tablet } from "lucide-react";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";

type Shot = { src: string; width: number; height: number; alt: string };

// Bezels and corners are sized in cqw, i.e. relative to each device's own width.
const SHADOW = "shadow-[0_40px_80px_-30px_rgb(15_30_60/0.55)]";

/** iPhone: titanium band, Dynamic Island. */
function IPhone({ shot, className }: { shot: Shot; className?: string }) {
  return (
    <div className={cn("@container", className)}>
      <div className={cn("relative rounded-[16cqw] bg-gradient-to-b from-zinc-400 via-zinc-600 to-zinc-700 p-[3.2cqw]", SHADOW)}>
        <span className="absolute top-[18%] -left-[1.2cqw] h-[6%] w-[1.4cqw] rounded-l bg-zinc-500" />
        <span className="absolute top-[27%] -left-[1.2cqw] h-[9%] w-[1.4cqw] rounded-l bg-zinc-500" />
        <span className="absolute top-[24%] -right-[1.2cqw] h-[12%] w-[1.4cqw] rounded-r bg-zinc-500" />
        <div className="relative overflow-hidden rounded-[13cqw] bg-black">
          <img src={shot.src} width={shot.width} height={shot.height} alt={shot.alt} loading="lazy" decoding="async" className="block h-auto w-full" />
          <span className="absolute top-[1.5%] left-1/2 h-[3.2%] w-[30%] -translate-x-1/2 rounded-full bg-black" />
        </div>
      </div>
    </div>
  );
}

/** Android: slim black bezel, punch-hole camera. */
function AndroidPhone({ shot, className }: { shot: Shot; className?: string }) {
  return (
    <div className={cn("@container", className)}>
      <div className={cn("relative rounded-[13cqw] bg-zinc-900 p-[2.6cqw] ring-1 ring-zinc-700", SHADOW)}>
        <span className="absolute top-[20%] -right-[1.1cqw] h-[10%] w-[1.3cqw] rounded-r bg-zinc-700" />
        <div className="relative overflow-hidden rounded-[10.5cqw] bg-black">
          <img src={shot.src} width={shot.width} height={shot.height} alt={shot.alt} loading="lazy" decoding="async" className="block h-auto w-full" />
          <span className="absolute top-[1.3%] left-1/2 aspect-square w-[4.2%] -translate-x-1/2 rounded-full bg-black ring-2 ring-zinc-800" />
        </div>
      </div>
    </div>
  );
}

function IPad({ shot, className }: { shot: Shot; className?: string }) {
  return (
    <div className={cn("@container", className)}>
      <div className={cn("relative rounded-[6.5cqw] bg-gradient-to-b from-zinc-500 to-zinc-700 p-[3cqw]", SHADOW)}>
        <div className="overflow-hidden rounded-[4cqw] bg-black">
          <img src={shot.src} width={shot.width} height={shot.height} alt={shot.alt} loading="lazy" decoding="async" className="block h-auto w-full" />
        </div>
      </div>
    </div>
  );
}

/** The Mac capture carries its own window chrome and rounded corners. */
function MacWindow({ shot, className }: { shot: Shot; className?: string }) {
  return (
    <img
      src={shot.src}
      width={shot.width}
      height={shot.height}
      alt={shot.alt}
      loading="lazy"
      decoding="async"
      className={cn("block h-auto w-full drop-shadow-[0_30px_50px_rgb(15_30_60/0.35)]", className)}
    />
  );
}

export async function NativeApps() {
  const t = await getT();
  const shots = {
    mac: { src: "/marketing/mac-insights.webp", width: 1600, height: 1025, alt: t("Batzio for Mac: the Insights overview") },
    ipad: { src: "/marketing/ipad-invoice.webp", width: 1100, height: 1467, alt: t("Batzio for iPad: an invoice, in German") },
    iphone: { src: "/marketing/iphone-today.webp", width: 640, height: 1391, alt: t("Batzio for iPhone: the Today screen") },
    android: { src: "/marketing/android-invoices.webp", width: 640, height: 1428, alt: t("Batzio for Android: invoices, in French") },
  };
  const platforms = [
    { icon: Smartphone, label: t("iPhone & Android") },
    { icon: Tablet, label: "iPad" },
    { icon: Laptop, label: "Mac" },
    { icon: AppWindow, label: "Windows 11" },
    { icon: Globe, label: t("Web, offline too") },
  ];
  return (
    <div className="space-y-10">
      {/* Desktop: one stage. */}
      <div className="relative mx-auto hidden aspect-[16/9.4] max-w-6xl lg:block">
        <MacWindow shot={shots.mac} className="absolute top-0 left-[11%] w-[72%]" />
        <IPad shot={shots.ipad} className="absolute bottom-0 left-0 w-[25%]" />
        <IPhone shot={shots.iphone} className="absolute right-[13%] bottom-0 w-[14.5%]" />
        <AndroidPhone shot={shots.android} className="absolute right-0 bottom-[3%] w-[14.5%]" />
      </div>
      {/* Phones and tablets: stacked. */}
      <div className="space-y-8 lg:hidden">
        <MacWindow shot={shots.mac} />
        <div className="mx-auto grid max-w-md grid-cols-2 gap-5 px-2">
          <IPhone shot={shots.iphone} />
          <AndroidPhone shot={shots.android} />
        </div>
        <IPad shot={shots.ipad} className="mx-auto max-w-sm" />
      </div>
      <ul className="flex flex-wrap justify-center gap-2">
        {platforms.map((p) => (
          <li key={p.label} className="neu-chip">
            <p.icon /> {p.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
