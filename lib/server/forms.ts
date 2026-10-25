import { getResource } from "@/lib/resources/registry";
import type { ResourceDef, Row } from "@/lib/resources/types";
import { refLabels, toApi } from "./crud";
import type { Ctx } from "./ctx";
import { getSettings } from "./settings";

/** Everything a record form needs from the server, in API representation. */
export async function formData(ctx: Ctx, res: ResourceDef, record: Row | null) {
  const labels: Record<string, Record<string, string>> = {};
  if (record) {
    Object.assign(labels, await refLabels(ctx, res, [record], getResource));
    for (const child of res.children ?? []) {
      const rows = (record[child.name] as Row[] | undefined) ?? [];
      const childLabels = await refLabels(ctx, { fields: child.fields }, rows, getResource);
      for (const [field, map] of Object.entries(childLabels)) labels[`${child.name}.${field}`] = map;
    }
  }
  const needsTaxes = res.view === "document";
  const taxes = needsTaxes
    ? await ctx.db.all<{ id: number; code: string; rate: number; type: "sales" | "purchase" }>(
        "SELECT id, code, rate, type FROM taxes WHERE is_active = 1 ORDER BY rate DESC, code",
      )
    : [];
  const rounding: Record<string, number> = {};
  if (needsTaxes) {
    for (const c of await ctx.db.all<{ code: string; rounding: number }>("SELECT code, rounding FROM currencies")) rounding[c.code] = c.rounding;
    rounding.CHF = (await getSettings(ctx, "accounting")).chf_rounding;
  }
  return { initial: record ? toApi(res, record) : {}, labels, taxes, rounding };
}
