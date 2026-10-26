import { handleDrop } from "@batzio/server/agent/http";

export const POST = (request: Request) => handleDrop(request);
