"use client";

import { ChevronDown, History } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useT } from "@batzio/i18n/react";

export interface RecordTab {
  value: string;
  label: string;
  /** Number of related records; null for tabs without a count (history). */
  count: number | null;
}

/**
 * Related records and history under a record: one row of tabs for what has
 * content, the empty relations tucked into “More” (that is where a first one
 * gets added). Scrolls sideways when even that row is too wide.
 */
export function RecordTabs({ tabs, children }: { tabs: RecordTab[]; children: React.ReactNode }) {
  const t = useT();
  const shown = tabs.filter((tab) => tab.count !== 0);
  const empty = tabs.filter((tab) => tab.count === 0);
  const [value, setValue] = useState(shown[0]?.value ?? empty[0]?.value);
  const picked = empty.find((tab) => tab.value === value);
  const row = picked ? [...shown, picked] : shown;

  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        if (next !== null) setValue(next);
      }}
      className="gap-4"
    >
      <div className="flex items-center gap-2 border-b">
        <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsList variant="line" className="h-10 w-max gap-0 p-0">
            {row.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="flex-none rounded-none px-3 group-data-horizontal/tabs:after:bottom-[-1px]">
                {tab.value === "history" && <History className="size-3.5" />}
                {tab.label}
                {tab.count ? <span className="num text-muted-foreground text-xs font-normal">{tab.count}</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {empty.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="text-muted-foreground shrink-0" />}>
              {t("More")} <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-auto">
              {empty.map((tab) => (
                <DropdownMenuItem key={tab.value} onSelect={() => setValue(tab.value)} className={cn(tab.value === value && "font-medium")}>
                  {tab.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {children}
    </Tabs>
  );
}
