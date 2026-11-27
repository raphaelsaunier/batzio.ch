"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@ui-sdk/react/toast";
import { loadThreadAction } from "@/app/(app)/[tenant]/agent-actions";
import { confetti } from "@/components/fun/confetti";
import type { AgentEvent } from "@batzio/server/agent/claude";
import type { DropOutcome } from "@batzio/server/agent/inbox";
import type { ToolOutcome, UiTurn } from "@batzio/server/agent/threads";
import { useLocale, useT } from "@batzio/i18n/react";

export interface LiveTurn {
  text: string;
  updates: string[];
  tools: ToolOutcome[];
  error?: string;
  noAgent?: boolean;
  files?: { id: number; name: string; mime: string | null }[];
  prompt?: string;
}

interface BatziContextValue {
  tenant: string;
  agent: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  threadId: string | null;
  turns: UiTurn[];
  live: LiveTurn | null;
  busy: boolean;
  dragging: boolean;
  ask: (text: string, opts?: { fileIds?: number[]; inboxIds?: number[]; files?: LiveTurn["files"] }) => Promise<void>;
  confirm: (toolUseId: string, approve: boolean) => Promise<void>;
  newThread: () => void;
  openThread: (id: string) => Promise<void>;
  /** Drops files: imports what it can, hands the rest to Batzi. */
  drop: (files: File[]) => Promise<void>;
  /** Uploads files without processing (chat attachments). */
  upload: (files: File[]) => Promise<{ id: number; name: string; mime: string | null }[]>;
}

const BatziContext = createContext<BatziContextValue | null>(null);

export function useBatzi() {
  const ctx = useContext(BatziContext);
  if (!ctx) throw new Error("useBatzi must be used inside <BatziProvider>");
  return ctx;
}

const THREAD_KEY = (tenant: string) => `batzio:thread:${tenant}`;
const CELEBRATE = new Set(["create_invoice", "run_record_action", "create_bill", "import_rows", "import_spreadsheet", "import_bank_file"]);

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function BatziProvider({ tenant, agent, children }: { tenant: string; agent: boolean; children: React.ReactNode }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [turns, setTurns] = useState<UiTurn[]>([]);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const threadRef = useRef<string | null>(null);
  threadRef.current = threadId;

  // Resume the last conversation of this company.
  useEffect(() => {
    let id: string | null = null;
    try {
      id = localStorage.getItem(THREAD_KEY(tenant));
    } catch {
      id = null;
    }
    if (!id) return;
    setThreadId(id);
    loadThreadAction(tenant, id)
      .then(setTurns)
      .catch(() => undefined);
  }, [tenant]);

  const remember = (id: string | null) => {
    setThreadId(id);
    try {
      if (id) localStorage.setItem(THREAD_KEY(tenant), id);
      else localStorage.removeItem(THREAD_KEY(tenant));
    } catch {
      /* private mode */
    }
  };

  const streamAgent = useCallback(
    async (body: Record<string, unknown>, seed: LiveTurn) => {
      setBusy(true);
      setLive(seed);
      let current: LiveTurn = seed;
      const patch = (fn: (l: LiveTurn) => LiveTurn) => {
        current = fn(current);
        setLive(current);
      };
      let celebrate = false;
      try {
        const res = await fetch(`/api/agent?tenant=${encodeURIComponent(tenant)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, threadId: threadRef.current, page: pathname, locale }),
        });
        if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error?.message ?? res.statusText);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const e = JSON.parse(line) as AgentEvent;
            if (e.type === "thread") remember(e.threadId);
            else if (e.type === "text") patch((l) => ({ ...l, text: l.text + e.delta }));
            else if (e.type === "update")
              patch((l) => (e.start || !l.updates.length ? { ...l, updates: [...l.updates, e.text] } : { ...l, updates: [...l.updates.slice(0, -1), l.updates.at(-1) + e.text] }));
            else if (e.type === "tool") {
              patch((l) => {
                const i = l.tools.findIndex((x) => x.id === e.outcome.id);
                const tools = i >= 0 ? l.tools.map((x, j) => (j === i ? e.outcome : x)) : [...l.tools, e.outcome];
                return { ...l, tools };
              });
              if (e.outcome.ok && !e.outcome.pending && e.outcome.summary !== "…" && CELEBRATE.has(e.outcome.tool)) celebrate = true;
            } else if (e.type === "error") patch((l) => (e.message === "no_agent" ? { ...l, noAgent: true } : { ...l, error: e.message }));
          }
        }
      } catch (error) {
        patch((l) => ({ ...l, error: error instanceof Error ? error.message : String(error) }));
      } finally {
        const id = threadRef.current;
        const fresh = id ? await loadThreadAction(tenant, id).catch(() => null) : null;
        if (fresh && !current.error && !current.noAgent) {
          setTurns(fresh);
          setLive(null);
        } else if (fresh) {
          setTurns(fresh);
        }
        setBusy(false);
        if (celebrate) confetti({ count: 70 });
        router.refresh();
      }
    },
    [tenant, pathname, locale, router],
  );

  const ask: BatziContextValue["ask"] = useCallback(
    async (text, opts = {}) => {
      if (!text.trim() && !opts.fileIds?.length) return;
      setOpen(true);
      await streamAgent({ text, fileIds: opts.fileIds, inboxIds: opts.inboxIds }, { text: "", updates: [], tools: [], files: opts.files, prompt: text });
    },
    [streamAgent],
  );

  const confirm: BatziContextValue["confirm"] = useCallback(
    async (toolUseId, approve) => {
      await streamAgent({ confirm: { toolUseId, approve } }, { text: "", updates: [], tools: [] });
    },
    [streamAgent],
  );

  const newThread = useCallback(() => {
    remember(null);
    setTurns([]);
    setLive(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openThread = useCallback(
    async (id: string) => {
      remember(id);
      setLive(null);
      setTurns(await loadThreadAction(tenant, id));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tenant],
  );

  const post = useCallback(
    async (files: File[], store: boolean) => {
      const form = new FormData();
      for (const f of files) form.append("files", f, f.name || "pasted.png");
      const res = await fetch(`/api/drop?tenant=${encodeURIComponent(tenant)}${store ? "&store=1" : ""}`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? res.statusText);
      return json as { data: DropOutcome[]; agent: boolean };
    },
    [tenant],
  );

  const upload: BatziContextValue["upload"] = useCallback(async (files) => (await post(files, true)).data.map((d) => d.file), [post]);

  const drop: BatziContextValue["drop"] = useCallback(
    async (files) => {
      if (!files.length) return;
      const pending = toast.loading(files.length === 1 ? t("Reading {name}…", { name: files[0].name || t("your file") }) : t("Reading {n} files…", { n: files.length }));
      try {
        const { data, agent: hasAgent } = await post(files, false);
        toast.dismiss(pending);
        const handled = data.filter((d) => d.handled);
        for (const d of handled) toast.success(t(d.message[0], d.message[1]), { description: d.file.name });
        if (handled.length) {
          confetti({ count: 50 });
          router.refresh();
        }
        const rest = data.filter((d) => !d.handled);
        if (!rest.length) return;
        if (hasAgent) {
          await ask("", { fileIds: rest.map((d) => d.file.id), inboxIds: rest.map((d) => d.inboxId), files: rest.map((d) => d.file) });
        } else {
          toast.info(t("{n} file(s) are waiting for you in the inbox.", { n: rest.length }), { description: t("Turn on Batzi (Anthropic API key) to have them read automatically.") });
          router.refresh();
        }
      } catch (error) {
        toast.dismiss(pending);
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [post, ask, router, t],
  );

  // Drop anywhere, paste anywhere (outside text fields).
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      // Drops on the chat composer attach instead (handled there).
      if ((e.target as HTMLElement | null)?.closest?.("[data-batzi-composer]")) return;
      void drop(Array.from(e.dataTransfer?.files ?? []));
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      void drop(files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("paste", onPaste);
    };
  }, [drop]);

  // ⌘J toggles the panel; the sidebar's “Tell Batzio” button opens it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "j" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onQuick = () => setOpen(true);
    const onAsk = (e: Event) => void ask((e as CustomEvent<string>).detail);
    window.addEventListener("keydown", onKey);
    window.addEventListener("batzio:quick", onQuick);
    window.addEventListener("batzio:ask", onAsk);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("batzio:quick", onQuick);
      window.removeEventListener("batzio:ask", onAsk);
    };
  }, [ask]);

  const value = useMemo<BatziContextValue>(
    () => ({ tenant, agent, open, setOpen, threadId, turns, live, busy, dragging, ask, confirm, newThread, openThread, drop, upload }),
    [tenant, agent, open, threadId, turns, live, busy, dragging, ask, confirm, newThread, openThread, drop, upload],
  );
  return <BatziContext.Provider value={value}>{children}</BatziContext.Provider>;
}
