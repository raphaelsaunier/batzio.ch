/**
 * Stand-in for SDKs that need the network (Claude). Batzi is unavailable on the
 * device, and the engine only reaches these when an API key is configured.
 */
const offline = () => {
  throw new Error("Batzi needs an internet connection.");
};

export default class Anthropic {
  constructor() {
    offline();
  }
}

export const toFile = offline;
