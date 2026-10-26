import type { R2LikeBucket, R2LikeObject } from "../../src/db/types";

/** In-memory stand-in for an R2 bucket. */
export class MemoryBucket implements R2LikeBucket {
  objects = new Map<string, { bytes: Uint8Array; type?: string }>();

  async put(key: string, value: ArrayBuffer | Uint8Array | ReadableStream | string, options?: { httpMetadata?: { contentType?: string } }) {
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, { bytes: new Uint8Array(bytes), type: options?.httpMetadata?.contentType });
  }

  async get(key: string): Promise<R2LikeObject | null> {
    const o = this.objects.get(key);
    if (!o) return null;
    return {
      body: new Response(o.bytes as BodyInit).body!,
      httpMetadata: { contentType: o.type },
      size: o.bytes.byteLength,
      arrayBuffer: async () => o.bytes.slice().buffer as ArrayBuffer,
    };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }
}
