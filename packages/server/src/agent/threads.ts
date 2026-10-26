import type Anthropic from "@anthropic-ai/sdk";
import type { Ctx } from "../ctx";
import { uuid } from "../auth/crypto";
import type { RecordRef } from "./importers";

/**
 * Conversations with Batzi are stored append-only, exactly as sent to and
 * received from Claude (thinking blocks included), so every later request
 * replays a byte-identical prefix. `display` holds what the UI renders.
 */
export type Block = Anthropic.Beta.BetaContentBlockParam;

export interface ToolOutcome {
  id: string;
  tool: string;
  title: string;
  ok: boolean;
  summary?: string;
  record?: RecordRef;
  /** Waiting for the user to confirm. */
  pending?: boolean;
  input?: Record<string, unknown>;
}

export type Display =
  | { kind: "user"; text: string; files?: { id: number; name: string; mime: string | null }[]; via?: "chat" | "drop" | "email" | "confirm" }
  | { kind: "assistant"; text: string; updates: string[]; refused?: boolean; fallback?: boolean }
  | { kind: "tools"; results: ToolOutcome[] }
  | { kind: "note"; text: string };

export interface StoredMessage {
  id: number;
  thread_id: string;
  role: "user" | "assistant";
  content: Block[];
  display: Display | null;
  created_at: string;
  created_by: string | null;
}

export const newThreadId = () => uuid();

export const threadOwner = (ctx: Ctx) => ctx.user?.id ?? `${ctx.actor.type}:${ctx.actor.id ?? ctx.actor.name}`;

export async function loadThread(ctx: Ctx, threadId: string): Promise<StoredMessage[]> {
  const rows = await ctx.db.all<{ id: number; thread_id: string; role: "user" | "assistant"; content: string; display: string | null; created_at: string; created_by: string | null }>(
    "SELECT * FROM agent_messages WHERE thread_id = ? ORDER BY id",
    threadId,
  );
  return rows.map((r) => ({ ...r, content: JSON.parse(r.content) as Block[], display: r.display ? (JSON.parse(r.display) as Display) : null }));
}

export async function appendMessage(ctx: Ctx, threadId: string, role: "user" | "assistant", content: Block[], display: Display | null): Promise<number> {
  const res = await ctx.db.run(
    "INSERT INTO agent_messages (thread_id, role, content, display, created_by) VALUES (?, ?, ?, ?, ?)",
    threadId,
    role,
    JSON.stringify(content),
    display ? JSON.stringify(display) : null,
    threadOwner(ctx),
  );
  return res.lastRowId;
}

export async function updateDisplay(ctx: Ctx, messageId: number, display: Display): Promise<void> {
  await ctx.db.run("UPDATE agent_messages SET display = ? WHERE id = ?", JSON.stringify(display), messageId);
}

/** Threads of the current user (newest first) with their opening line. */
export async function listThreads(ctx: Ctx, limit = 20) {
  const rows = await ctx.db.all<{ thread_id: string; started: string; last: string; first_display: string | null; count: number }>(
    `SELECT thread_id, min(created_at) AS started, max(created_at) AS last, count(*) AS count,
            (SELECT display FROM agent_messages m2 WHERE m2.thread_id = m.thread_id AND m2.role = 'user' ORDER BY id LIMIT 1) AS first_display
     FROM agent_messages m WHERE created_by = ? GROUP BY thread_id ORDER BY last DESC LIMIT ?`,
    threadOwner(ctx),
    limit,
  );
  return rows.map((r) => {
    const d = r.first_display ? (JSON.parse(r.first_display) as Display) : null;
    return { id: r.thread_id, started: r.started, last: r.last, count: r.count, title: d && "text" in d ? d.text.slice(0, 80) : "…" };
  });
}

export async function threadBelongsTo(ctx: Ctx, threadId: string): Promise<boolean> {
  const owner = await ctx.db.value<string>("SELECT created_by FROM agent_messages WHERE thread_id = ? ORDER BY id LIMIT 1", threadId);
  return owner === null || owner === threadOwner(ctx);
}

/** UI view of a thread: user bubbles and assistant turns with their tool outcomes. */
export interface UiTurn {
  id: number;
  role: "user" | "assistant";
  text: string;
  at: string;
  files?: { id: number; name: string; mime: string | null }[];
  via?: string;
  updates?: string[];
  tools?: ToolOutcome[];
  refused?: boolean;
}

export function toUiTurns(messages: StoredMessage[]): UiTurn[] {
  const turns: UiTurn[] = [];
  let current: UiTurn | null = null;
  for (const m of messages) {
    const d = m.display;
    if (!d) continue;
    if (d.kind === "user") {
      current = null;
      turns.push({ id: m.id, role: "user", text: d.text, at: m.created_at, files: d.files, via: d.via });
    } else if (d.kind === "note") {
      current = null;
      turns.push({ id: m.id, role: "assistant", text: d.text, at: m.created_at });
    } else {
      if (!current) {
        current = { id: m.id, role: "assistant", text: "", at: m.created_at, updates: [], tools: [] };
        turns.push(current);
      }
      if (d.kind === "assistant") {
        if (d.text) current.text = current.text ? `${current.text}\n\n${d.text}` : d.text;
        current.updates!.push(...d.updates);
        if (d.refused) current.refused = true;
      } else {
        for (const r of d.results) {
          const i = current.tools!.findIndex((t) => t.id === r.id);
          if (i >= 0) current.tools![i] = r;
          else current.tools!.push(r);
        }
      }
    }
  }
  return turns;
}
