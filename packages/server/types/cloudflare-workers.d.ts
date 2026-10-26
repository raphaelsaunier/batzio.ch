/**
 * Minimal ambient declaration for the Workers runtime module.
 * Batzio types the bindings itself (see lib/server/env.ts), so we do not depend
 * on generated runtime types for type-checking.
 */
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
