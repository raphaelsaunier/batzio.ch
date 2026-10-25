import { friendlyFields, friendlyResource } from "@/lib/friendly";
import { getT } from "@/lib/i18n/server";
import { toClientResource, translateField } from "@/lib/resources/client";
import type { ResourceDef } from "@/lib/resources/types";
import { getMode } from "./mode";

/**
 * A resource as the current user should see it: plain words in simple mode,
 * classic terms behind the accountant goggles, always in their language.
 */
export async function resourceView(res: ResourceDef) {
  const [mode, t] = await Promise.all([getMode(), getT()]);
  const f = friendlyResource(res, mode);
  const raw = friendlyFields(res, mode);
  return {
    mode,
    t,
    label: t(f.label),
    labelPlural: t(f.labelPlural),
    description: t(f.description),
    empty: f.empty ? { title: t(f.empty.title), text: t(f.empty.text), mood: f.empty.mood } : null,
    fields: raw.map((x) => translateField(x, t)),
    client: toClientResource({ ...res, label: f.label, labelPlural: f.labelPlural, description: f.description, fields: raw }, t),
  };
}
