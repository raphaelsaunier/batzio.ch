import { beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { confirmToolUse, runAgent, type AgentEvent } from "@/lib/agent/claude";
import { loadThread, newThreadId, toUiTurns } from "@/lib/agent/threads";
import { getResource } from "@/lib/resources/registry";
import { getRecord } from "@/lib/server/crud";
import type { Ctx } from "@/lib/server/ctx";
import { seedDemo } from "@/lib/server/seed";
import { makeCtx } from "./helpers/tenant";

type Msg = Anthropic.Beta.BetaMessage;
type Block = Msg["content"][number];

const message = (content: Block[], stop: Msg["stop_reason"]): Msg =>
  ({ id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }) as unknown as Msg;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as unknown as Block;
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input }) as unknown as Block;

/** A scripted stand-in for the Anthropic client that records every request. */
function fakeClient(script: Msg[]) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: Record<string, unknown>) {
          requests.push(JSON.parse(JSON.stringify(params)));
          const next = script.shift();
          if (!next) throw new Error("script exhausted");
          return {
            async *[Symbol.asyncIterator]() {
              for (const b of next.content) if (b.type === "text") yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: b.text } };
            },
            finalMessage: async () => next,
          };
        },
      },
    },
  } as unknown as Pick<Anthropic, "beta">;
  return { client, requests };
}

let ctx: Ctx;
beforeAll(async () => {
  ctx = await makeCtx();
  await seedDemo(ctx);
});

describe("agent loop", () => {
  it("runs tools, persists the thread append-only and streams events", async () => {
    const { client, requests } = fakeClient([
      message([text("On it."), toolUse("tu_1", "create_invoice", { customer: "Bergsicht Hotels", positions: [{ text: "Consulting", quantity: 2, unit_price: 150 }], issue: true })], "tool_use"),
      message([text("Invoice is out.")], "end_turn"),
    ]);
    const events: AgentEvent[] = [];
    const threadId = newThreadId();
    await runAgent(ctx, threadId, [{ type: "text", text: "Invoice Bergsicht 2h consulting at 150" }], { kind: "user", text: "Invoice Bergsicht 2h consulting at 150" }, { locale: "en", client, emit: (e) => events.push(e) });

    expect(requests).toHaveLength(2);
    expect(requests[0].model).toBe("claude-opus-5-5");
    expect(requests[0].fallbacks).toBe("default");
    expect((requests[0].thinking as { type: string }).type).toBe("adaptive");
    expect(requests[0].tool_choice).toBeUndefined();
    // Same system prompt and tools on every step; history only grows.
    expect(JSON.stringify(requests[1].system)).toBe(JSON.stringify(requests[0].system));
    expect(JSON.stringify(requests[1].tools)).toBe(JSON.stringify(requests[0].tools));
    const [m0, m1] = [requests[0].messages as unknown[], requests[1].messages as unknown[]];
    expect(JSON.stringify(m1.slice(0, m0.length))).toBe(JSON.stringify(m0));

    const turns = toUiTurns(await loadThread(ctx, threadId));
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    const tool = turns[1].tools![0];
    expect(tool.ok).toBe(true);
    expect(tool.record?.resource).toBe("invoices");
    const invoice = await getRecord(ctx, getResource("invoices")!, tool.record!.id);
    expect(invoice.status).toBe("open");
    expect(events.some((e) => e.type === "text")).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  });

  it("holds destructive tools until the user confirms", async () => {
    const draft = await getResource("contacts")!;
    const { client } = fakeClient([
      message([toolUse("tu_del", "delete_record", { resource: "contacts", id: 1 })], "tool_use"),
      message([text("Shall I archive it? Press confirm.")], "end_turn"),
      message([text("Archived.")], "end_turn"),
    ]);
    const threadId = newThreadId();
    await runAgent(ctx, threadId, [{ type: "text", text: "archive contact 1" }], { kind: "user", text: "archive contact 1" }, { locale: "en", client });
    let turns = toUiTurns(await loadThread(ctx, threadId));
    expect(turns[1].tools![0].pending).toBe(true);
    expect((await getRecord(ctx, draft, 1)).archived_at).toBeFalsy();

    await confirmToolUse(ctx, threadId, "tu_del", true, { locale: "en", client });
    turns = toUiTurns(await loadThread(ctx, threadId));
    expect(turns.at(-1)?.text).toContain("Archived.");
    expect(turns.at(-1)?.tools?.[0].pending).toBeFalsy();
    expect((await getRecord(ctx, draft, 1)).archived_at).toBeTruthy();
  });

  it("reports refusals without crashing", async () => {
    const { client } = fakeClient([message([], "refusal")]);
    const events: AgentEvent[] = [];
    await runAgent(ctx, newThreadId(), [{ type: "text", text: "…" }], { kind: "user", text: "…" }, { locale: "en", client, emit: (e) => events.push(e) });
    expect(events.at(-1)).toEqual({ type: "done", refused: true });
  });

  it("refuses to run without a brain", async () => {
    const events: AgentEvent[] = [];
    await runAgent(ctx, newThreadId(), [], null, { locale: "en", emit: (e) => events.push(e) });
    expect(events[0].type).toBe("error");
  });
});
