import { describe, expect, it } from "vitest";
import { COMPAT_PREFIX, dispatchCompat } from "../src/compat/index";
import type { Ctx } from "../src/ctx";
import { importStep, type ImportProgress } from "../src/importer";
import { seedDemo } from "../src/seed";
import { makeCtx } from "./helpers/tenant";

/** A source company reachable over "HTTP": Batzio's own compatibility API, in process. */
function serve(source: Ctx, token: string) {
  return async (url: string, init?: RequestInit) => {
    if (new Headers(init?.headers).get("authorization") !== `Bearer ${token}`) return new Response("{}", { status: 401 });
    const path = new URL(url).pathname.slice(COMPAT_PREFIX.length);
    return dispatchCompat(async () => source, new Request(url, init), path);
  };
}

async function importAll(target: Ctx, fetch: ReturnType<typeof serve>, restart = false): Promise<ImportProgress> {
  let progress: ImportProgress;
  let steps = 0;
  do {
    progress = await importStep(target, { baseUrl: `https://source.test${COMPAT_PREFIX}`, token: "secret", fetch }, { budgetMs: 400, restart: restart && steps === 0 });
    steps++;
  } while (progress.phase !== "done" && steps < 500);
  return progress;
}

const scalar = async (ctx: Ctx, sql: string) => Number(await ctx.db.value(sql)) || 0;

describe("moving in from other software", () => {
  it("copies a whole company through the API, in resumable steps, without duplicates", async () => {
    const source = await makeCtx();
    await seedDemo(source);
    const target = await makeCtx();
    const fetch = serve(source, "secret");

    const progress = await importAll(target, fetch);
    expect(progress.phase).toBe("done");
    expect(Object.values(progress.counts).map((c) => c.failed)).toEqual(Object.values(progress.counts).map(() => 0));
    expect(progress.warnings).toEqual([]);

    // Master data arrives complete.
    for (const table of ["contacts", "items", "projects", "timesheets", "tasks"]) {
      expect(await scalar(target, `SELECT count(*) FROM ${table}`), table).toBe(await scalar(source, `SELECT count(*) FROM ${table}`));
    }
    // Documents keep their numbers, totals and states; issued invoices are booked again.
    const documents = (ctx: Ctx) =>
      ctx.db.all<{ kind: string; nr: string; status: string; total: number; amount_open: number }>(
        "SELECT kind, nr, status, total, amount_open FROM documents WHERE kind IN ('quote', 'order', 'invoice') ORDER BY kind, nr",
      );
    expect(await documents(target)).toEqual(await documents(source));
    expect(await scalar(target, "SELECT count(*) FROM journal_entries WHERE type = 'invoice'")).toBe(await scalar(source, "SELECT count(*) FROM journal_entries WHERE type = 'invoice'"));
    // Supplier bills and expenses with their amounts.
    expect(await scalar(target, "SELECT sum(total) FROM bills")).toBe(await scalar(source, "SELECT sum(total) FROM bills"));
    expect(await scalar(target, "SELECT sum(amount) FROM expenses")).toBe(await scalar(source, "SELECT sum(amount) FROM expenses"));

    // New numbers continue after the imported ones.
    const highest = await target.db.value<string>("SELECT max(nr) FROM documents WHERE kind = 'invoice'");
    const { nextNumber } = await import("../src/numbering");
    expect(await nextNumber(target, "invoice") > String(highest)).toBe(true);

    // Running it again adds nothing.
    const before = await scalar(target, "SELECT count(*) FROM contacts");
    const again = await importAll(target, fetch, true);
    expect(again.counts.contacts?.imported ?? 0).toBe(0);
    expect(await scalar(target, "SELECT count(*) FROM contacts")).toBe(before);
  });

  it("refuses a wrong token without touching the books", async () => {
    const source = await makeCtx();
    const target = await makeCtx();
    await expect(importStep(target, { baseUrl: `https://source.test${COMPAT_PREFIX}`, token: "wrong", fetch: serve(source, "secret") })).rejects.toThrow(/access token/);
    expect(await scalar(target, "SELECT count(*) FROM import_map")).toBe(0);
  });
});
