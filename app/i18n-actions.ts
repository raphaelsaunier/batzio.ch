"use server";

import { revalidatePath } from "next/cache";
import { isLocale } from "@/lib/i18n";
import { setLocaleCookie } from "@/lib/i18n/server";
import { currentUser, getControl } from "@/lib/server/session";

/** Switches the interface language and remembers it on the user for next time. */
export async function setLocaleAction(locale: string) {
  if (!isLocale(locale)) return;
  await setLocaleCookie(locale);
  const user = await currentUser();
  if (user) await (await getControl()).run("UPDATE users SET locale = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", locale, user.id);
  revalidatePath("/", "layout");
}
