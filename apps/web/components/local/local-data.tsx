"use client";

import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import type { QueryClient } from "@tanstack/react-query";
import { CloudOff } from "lucide-react";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "@batzio/i18n/react";
import { makePersister, makeQueryClient, warmRecords } from "@/lib/local/store";

interface LocalData {
  tenant: string;
  queryClient: QueryClient;
}

const LocalDataContext = createContext<LocalData | null>(null);

export function useLocalData(): LocalData {
  const value = useContext(LocalDataContext);
  if (!value) throw new Error("useLocalData must be used inside <LocalDataProvider>");
  return value;
}

const subscribeOnline = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

const idle = () => new Promise<void>((resolve) => ("requestIdleCallback" in window ? window.requestIdleCallback(() => resolve(), { timeout: 2000 }) : setTimeout(resolve, 200)));

/**
 * The company's local copy of its data (TanStack Query + TanStack DB, persisted
 * to IndexedDB). After the first paint it quietly syncs the main lists, so they
 * open instantly — and keep working offline.
 */
export function LocalDataProvider({ tenant, version, warm, children }: { tenant: string; version: string; warm: string[]; children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [persister] = useState(() => makePersister(tenant));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await new Promise((r) => setTimeout(r, 1500));
      for (const resource of warm) {
        if (cancelled || !navigator.onLine) return;
        await idle();
        await warmRecords(queryClient, tenant, resource).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryClient, tenant, warm]);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 7 * 24 * 60 * 60_000, buster: version }}>
      <LocalDataContext.Provider value={{ tenant, queryClient }}>{children}</LocalDataContext.Provider>
    </PersistQueryClientProvider>
  );
}

/** A quiet pill while the connection is gone; everything already seen keeps working. */
export function OfflineBadge() {
  const online = useOnline();
  const t = useT();
  if (online) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/15 px-2.5 py-1 text-xs font-medium">
      <CloudOff className="size-3.5" />
      {t("Offline — showing what’s saved on this device")}
    </span>
  );
}
