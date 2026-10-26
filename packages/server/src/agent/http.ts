import { apiContext } from "../api/context";
import { requestLocale } from "../api/locale";
import { renderMsg } from "@batzio/i18n";
import { tFor } from "@batzio/i18n/server";
import type { Ctx } from "../ctx";
import { getEnv } from "../env";
import { toAppError } from "../errors";
import { MAX_FILE_BYTES, storeFile } from "../files";
import { confirmToolUse, contextBlock, fileBlocks, runAgent, type AgentEvent } from "./claude";
import { dropFiles, updateInboxItem } from "./inbox";
import { newThreadId, threadBelongsTo } from "./threads";

export { requestLocale };

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });


async function context(request: Request): Promise<Ctx | Response> {
  try {
    return await apiContext(request, "agent");
  } catch (error) {
    const e = toAppError(error);
    return json(e.toJSON(), e.status);
  }
}

interface AgentBody {
  threadId?: string;
  text?: string;
  fileIds?: number[];
  inboxIds?: number[];
  page?: string;
  locale?: string;
  confirm?: { toolUseId: string; approve: boolean };
}

/**
 * POST /api/agent — talk to Batzi. Streams NDJSON events (text deltas,
 * progress updates, tool outcomes) while the agent works.
 */
export async function handleAgent(request: Request): Promise<Response> {
  if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: { code: "validation", message: "Send JSON." } }, 415);
  const ctx = await context(request);
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => ({}))) as AgentBody;
  const locale = requestLocale(request, body.locale);
  const apiKey = getEnv().ANTHROPIC_API_KEY ?? null;
  if (body.threadId && !(await threadBelongsTo(ctx, body.threadId))) return json({ error: { code: "forbidden", message: "This conversation belongs to someone else." } }, 403);
  const threadId = body.threadId || newThreadId();
  const fileIds = (body.fileIds ?? []).map(Number).filter(Number.isFinite).slice(0, 10);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: AgentEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        const env = { apiKey, locale, page: body.page ?? null, emit };
        if (body.confirm) {
          await confirmToolUse(ctx, threadId, body.confirm.toolUseId, !!body.confirm.approve, env);
        } else if (!apiKey) {
          emit({ type: "thread", threadId });
          emit({ type: "error", message: "no_agent" });
        } else {
          const files = fileIds.length ? await ctx.db.all<{ id: number; name: string; mime_type: string | null }>(`SELECT id, name, mime_type FROM files WHERE id IN (${fileIds.map(() => "?").join(",")})`, ...fileIds) : [];
          const text = body.text?.trim() ?? "";
          const content = [contextBlock(ctx, env), ...(text ? [{ type: "text" as const, text }] : []), ...(await fileBlocks(ctx, apiKey, fileIds))];
          if (!text && files.length) content.push({ type: "text", text: "Take care of these files." });
          await runAgent(ctx, threadId, content, { kind: "user", text, files: files.map((f) => ({ id: f.id, name: f.name, mime: f.mime_type })), via: files.length && !text ? "drop" : "chat" }, env);
          for (const id of body.inboxIds ?? []) await updateInboxItem(ctx, Number(id), { status: "done", thread_id: threadId });
        }
      } catch (error) {
        emit({ type: "error", message: toAppError(error).message });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Thread-Id": threadId } });
}

/** POST /api/drop — multipart files; handles what it can, returns what is left for Batzi. */
export async function handleDrop(request: Request): Promise<Response> {
  const ctx = await context(request);
  if (ctx instanceof Response) return ctx;
  try {
    const form = await request.formData();
    const files: { name: string; type: string; bytes: ArrayBuffer }[] = [];
    for (const value of form.getAll("files")) {
      if (typeof value === "string" || !value.size) continue;
      if (value.size > MAX_FILE_BYTES) return json({ error: { code: "validation", message: "Files must be smaller than 25 MB." } }, 413);
      files.push({ name: value.name || "upload", type: value.type, bytes: await value.arrayBuffer() });
    }
    if (!files.length) return json({ error: { code: "validation", message: "No files received." } }, 422);
    if (new URL(request.url).searchParams.get("store") === "1") {
      // Chat attachments: just keep them; Batzi decides what to do.
      const stored = [];
      for (const f of files.slice(0, 10)) {
        const row = await storeFile(ctx, f, { description: "Attached in chat" });
        stored.push({ file: { id: row.id, name: row.name, mime: row.mime_type } });
      }
      return json({ data: stored, agent: !!getEnv().ANTHROPIC_API_KEY });
    }
    const outcomes = await dropFiles(ctx, files.slice(0, 20), "upload");
    // `text` is the message already in the caller's language (native apps); the web translates `message` itself.
    const t = tFor(requestLocale(request));
    return json({ data: outcomes.map((o) => ({ ...o, text: renderMsg(t, o.message) })), agent: !!getEnv().ANTHROPIC_API_KEY });
  } catch (error) {
    const e = toAppError(error);
    return json(e.toJSON(), e.status);
  }
}
