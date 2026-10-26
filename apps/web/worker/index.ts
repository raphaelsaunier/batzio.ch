import handler from "vinext/server/fetch-handler";
import { handleEmail } from "@batzio/server/http";
import { NAVIGATION_HEADER } from "../lib/navigation";

/**
 * Worker entry: the vinext app handles HTTP; email() receives mail routed to
 * the company inbox addresses by Cloudflare Email Routing.
 */
export default {
  ...handler,
  fetch(...[request, ...rest]: Parameters<typeof handler.fetch>) {
    // Flag client-side navigations so layouts can leave out what the browser already holds.
    if (request.headers.get("rsc") === "1") {
      const headers = new Headers(request.headers);
      headers.set(NAVIGATION_HEADER, "1");
      request = new Request(request, { headers });
    }
    return handler.fetch(request, ...rest);
  },
  email: handleEmail,
};
