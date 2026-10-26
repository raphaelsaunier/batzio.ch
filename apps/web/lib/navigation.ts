import { headers } from "next/headers";

/**
 * Set by the Worker entry on client-side navigations (RSC requests). Server
 * components can't read the flight headers themselves: `headers()` strips them.
 */
export const NAVIGATION_HEADER = "x-batzio-navigation";

/** True when the browser already runs the app and only needs the new route's payload. */
export async function isClientNavigation() {
  return (await headers()).get(NAVIGATION_HEADER) === "1";
}
