import { handleAgent } from "@/lib/agent/http";

export const POST = (request: Request) => handleAgent(request);
