"use client";

import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { clear, createStore, del, get, set, type UseStore } from "idb-keyval";

/**
 * Batzio's local-first data layer: every list the user opens (and the main ones,
 * warmed in the background) lives in TanStack DB collections backed by TanStack
 * Query and persisted to IndexedDB. Screens render from that local copy at once,
 * offline included, and revalidate against `/api/v1/app/records` behind the scenes.
 */

export type Labels = Record<string, Record<string, string>>;

/** A record as stored (Rappen, 0/1), plus what local search and display need. */
export interface LocalRow {
  id: number;
  /** Human-readable title (invoice number, contact name, …). */
  _title: string;
  /** Lower-case haystack for instant search: title, text fields, reference names. */
  _search: string;
  [field: string]: unknown;
}

export interface RecordsSnapshot {
  rows: LocalRow[];
  labels: Labels;
  total: number;
  /** False when the company has more rows than are kept locally. */
  complete: boolean;
  syncedAt: number;
}

/** Enough for any SME list; larger tables fall back to server search. */
export const MAX_LOCAL_ROWS = 2000;
const PAGE = 500;

export const recordsKey = (tenant: string, resource: string) => ["records", tenant, resource] as const;

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 7 * 24 * 60 * 60_000,
        // Serve the local copy first, even without a connection.
        networkMode: "offlineFirst",
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  });
}

let idb: UseStore | null = null;
const cacheStore = () => (typeof indexedDB === "undefined" ? null : (idb ??= createStore("batzio", "cache")));

/** IndexedDB persistence for the query cache (and so for every collection). */
export function makePersister(tenant: string) {
  const store = cacheStore();
  return createAsyncStoragePersister({
    key: `batzio:${tenant}`,
    throttleTime: 1000,
    storage: store
      ? { getItem: (k) => get<string>(k, store), setItem: (k, v) => set(k, v, store), removeItem: (k) => del(k, store) }
      : { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
  });
}

export async function fetchRecords(tenant: string, resource: string, signal?: AbortSignal): Promise<RecordsSnapshot> {
  const rows: LocalRow[] = [];
  const labels: Labels = {};
  let total = 0;
  for (let offset = 0; offset < MAX_LOCAL_ROWS; offset += PAGE) {
    const res = await fetch(`/api/v1/app/records/${resource}?shape=db&limit=${PAGE}&offset=${offset}`, {
      headers: { "X-Tenant": tenant, Accept: "application/json" },
      credentials: "same-origin",
      signal,
    });
    if (!res.ok) throw new Error(`Could not load ${resource} (${res.status})`);
    const { data } = (await res.json()) as {
      data: { rows: Record<string, unknown>[]; labels: Labels; titles: Record<string, string>; total: number };
    };
    total = data.total;
    for (const [field, map] of Object.entries(data.labels)) labels[field] = { ...labels[field], ...map };
    for (const row of data.rows) rows.push(enrich(row, data.titles, data.labels));
    if (data.rows.length < PAGE || rows.length >= total) break;
  }
  return { rows, labels, total, complete: rows.length >= total, syncedAt: Date.now() };
}

function enrich(row: Record<string, unknown>, titles: Record<string, string>, labels: Labels): LocalRow {
  const id = Number(row.id);
  const title = titles[String(id)] ?? `#${id}`;
  const parts = [title];
  for (const [field, value] of Object.entries(row)) {
    if (typeof value === "string" && value.length < 200 && !/^\d{4}-\d{2}-\d{2}/.test(value)) parts.push(value);
    else if (value !== null && labels[field]?.[String(value)]) parts.push(labels[field][String(value)]);
  }
  return { ...row, id, _title: title, _search: parts.join(" ").toLowerCase() };
}

function createRecordsCollection(queryClient: QueryClient, tenant: string, resource: string) {
  return createCollection(
    queryCollectionOptions({
      id: `records:${tenant}:${resource}`,
      queryKey: recordsKey(tenant, resource),
      queryFn: ({ signal }) => fetchRecords(tenant, resource, signal),
      select: (snapshot: RecordsSnapshot) => snapshot.rows,
      queryClient,
      getKey: (row: LocalRow) => row.id,
    }),
  );
}

export type RecordsCollection = ReturnType<typeof createRecordsCollection>;

const collections = new WeakMap<QueryClient, Map<string, RecordsCollection>>();

/** One stable collection per company and resource. */
export function recordsCollection(queryClient: QueryClient, tenant: string, resource: string): RecordsCollection {
  let byResource = collections.get(queryClient);
  if (!byResource) {
    byResource = new Map();
    collections.set(queryClient, byResource);
  }
  const key = `${tenant}/${resource}`;
  let collection = byResource.get(key);
  if (!collection) {
    collection = createRecordsCollection(queryClient, tenant, resource);
    byResource.set(key, collection);
  }
  return collection;
}

/** Loads a list into the local store ahead of time (hover, idle warm-up). */
export function warmRecords(queryClient: QueryClient, tenant: string, resource: string) {
  return queryClient.prefetchQuery({
    queryKey: recordsKey(tenant, resource),
    queryFn: ({ signal }) => fetchRecords(tenant, resource, signal),
    staleTime: 60_000,
  });
}

/** Removes every company's local copy and the offline pages (on the sign-in page). */
export async function forgetLocalData() {
  const store = cacheStore();
  await Promise.all([store && clear(store), typeof caches !== "undefined" && caches.delete("batzio-pages")]);
}
