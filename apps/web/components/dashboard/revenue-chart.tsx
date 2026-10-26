"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const config = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  expenses: { label: "Expenses", color: "var(--chart-3)" },
} satisfies ChartConfig;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function RevenueChart({ data }: { data: { month: string; revenue: number; expenses: number }[] }) {
  const rows = data.map((d) => ({
    label: `${MONTHS[Number(d.month.slice(5, 7)) - 1]} ${d.month.slice(2, 4)}`,
    revenue: Math.round(d.revenue) / 100,
    expenses: Math.round(d.expenses) / 100,
  }));
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <BarChart data={rows} margin={{ left: 4, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          fontSize={11}
          tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <div className="flex w-full justify-between gap-6">
                  <span className="text-muted-foreground">{config[name as keyof typeof config]?.label ?? String(name)}</span>
                  <span className="font-medium tabular-nums">
                    CHF {Number(value).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartContainer>
  );
}
