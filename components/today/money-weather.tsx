"use client";

import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { CountUp } from "@/components/fun/count-up";
import { Term } from "@/components/i18n/term";
import { formatAmount, formatDate } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { MoneyWeather as Weather } from "@/lib/server/nudges";
import { cn } from "@/lib/utils";

const ICON = { sunny: "☀️", cloudy: "⛅", rainy: "🌧️" } as const;

export function MoneyWeather({ weather, className }: { weather: Weather; className?: string }) {
  const t = useT();
  const forecast =
    weather.mood === "rainy"
      ? t("Rain ahead: cash could dip to CHF {amount} around {date}.", { amount: formatAmount(weather.low.balance), date: formatDate(weather.low.week) })
      : weather.mood === "cloudy"
        ? t("Cloudy: more is going out than coming in over the next 8 weeks.")
        : t("Sunny: you’re covered for the next 8 weeks.");
  const data = weather.weeks.map((w) => ({ week: w.week, balance: w.balance / 100 }));
  return (
    <div className={cn("bg-card relative overflow-hidden rounded-2xl border p-5 shadow-xs", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            <Term id="liquidity">{t("Money weather")}</Term>
          </p>
          <p className="font-display num mt-1 text-3xl font-bold tracking-tight">
            <CountUp cents={weather.cash} prefix="CHF " />
          </p>
        </div>
        <span className="text-4xl leading-none" aria-hidden>
          {ICON[weather.mood]}
        </span>
      </div>
      <p className="text-muted-foreground mt-1 text-sm">{forecast}</p>
      <div className="mt-3 h-20">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="weather-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={["dataMin - 1000", "dataMax + 1000"]} />
            {weather.low.balance < 0 && <ReferenceLine y={0} stroke="var(--destructive)" strokeDasharray="3 3" />}
            <Tooltip
              cursor={false}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="bg-popover rounded-md border px-2 py-1 text-xs shadow">
                    {formatDate(String(payload[0].payload.week))}: CHF {formatAmount(Math.round(Number(payload[0].value) * 100))}
                  </div>
                ) : null
              }
            />
            <Area type="monotone" dataKey="balance" stroke="var(--chart-1)" strokeWidth={2} fill="url(#weather-fill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex justify-between text-xs">
        <span className="text-success">
          ↓ {t("in")} CHF {formatAmount(weather.incoming)}
        </span>
        <span className="text-muted-foreground">{t("next 8 weeks")}</span>
        <span className="text-destructive">
          ↑ {t("out")} CHF {formatAmount(weather.outgoing)}
        </span>
      </div>
    </div>
  );
}
