import { cookies } from "next/headers";
import { cache } from "react";
import { MODE_COOKIE, type UiMode } from "@batzio/server/friendly";

/** Simple mode by default; "accountant goggles" reveal the ledger and classic terms. */
export const getMode = cache(async (): Promise<UiMode> => {
  const value = (await cookies()).get(MODE_COOKIE)?.value;
  return value === "accountant" ? "accountant" : "simple";
});
