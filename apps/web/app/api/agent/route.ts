import { handleAgent } from "@batzio/server/agent/http";

export const POST = (request: Request) => handleAgent(request);
