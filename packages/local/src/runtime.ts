/**
 * The slice of the web platform Batzio's engine uses, for bare JavaScript
 * engines (JavaScriptCore in the Apple apps, V8 through ClearScript on Windows).
 * Each piece is installed only when the engine lacks it, so a WebView (Android)
 * keeps its native implementations.
 *
 * This module must be imported before anything else: some engine modules create
 * a TextEncoder or read `crypto` while they load.
 */
import { host } from "./host-api";
import { fromBase64, pbkdf2Sha256, sha256, toBase64 } from "./bytes";

const g = globalThis as Record<string, unknown>;
const define = (name: string, value: unknown) => {
  if (typeof g[name] === "undefined") Object.defineProperty(g, name, { value, writable: true, configurable: true });
};

// ------------------------------------------------------------------ console, timers

define("console", {
  log: (...a: unknown[]) => host().log("info", a.map(String).join(" ")),
  info: (...a: unknown[]) => host().log("info", a.map(String).join(" ")),
  debug: (...a: unknown[]) => host().log("debug", a.map(String).join(" ")),
  warn: (...a: unknown[]) => host().log("warn", a.map(String).join(" ")),
  error: (...a: unknown[]) => host().log("error", a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack ?? ""}` : String(x))).join(" ")),
});
define("queueMicrotask", (fn: () => void) => void Promise.resolve().then(fn));

// The engine never waits for wall-clock time; timers only yield (pdf-lib does so
// while writing), so they run as soon as the current job is done.
let nextTimer = 1;
const cancelled = new Set<number>();
define("setTimeout", (fn: (...a: unknown[]) => void, _ms?: number, ...args: unknown[]) => {
  const id = nextTimer++;
  void Promise.resolve().then(() => {
    if (!cancelled.delete(id)) fn(...args);
  });
  return id;
});
define("clearTimeout", (id: number) => void cancelled.add(id));
define("setInterval", () => 0);
define("clearInterval", () => undefined);
define("performance", { now: () => Date.now(), timeOrigin: Date.now() });
define("structuredClone", (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value))));

// ------------------------------------------------------------------ text and base64

class TextEncoderPolyfill {
  readonly encoding = "utf-8";
  encode(input = ""): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < input.length; i++) {
      let c = input.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < input.length) {
        const d = input.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        } else c = 0xfffd;
      } else if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
  encodeInto(input: string, dest: Uint8Array) {
    const bytes = this.encode(input);
    dest.set(bytes.subarray(0, dest.length));
    return { read: input.length, written: Math.min(bytes.length, dest.length) };
  }
}

class TextDecoderPolyfill {
  readonly encoding: string;
  readonly fatal = false;
  readonly ignoreBOM: boolean;
  constructor(label = "utf-8", options: { ignoreBOM?: boolean } = {}) {
    const l = label.toLowerCase();
    if (l !== "utf-8" && l !== "utf8" && l !== "latin1" && l !== "iso-8859-1" && l !== "ascii" && l !== "us-ascii" && l !== "windows-1252") {
      throw new RangeError(`Unsupported encoding: ${label}`);
    }
    this.encoding = l === "utf8" ? "utf-8" : l;
    this.ignoreBOM = !!options.ignoreBOM;
  }
  decode(input?: ArrayBuffer | ArrayBufferView): string {
    if (!input) return "";
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (this.encoding !== "utf-8") {
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return s;
    }
    let i = !this.ignoreBOM && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    const parts: string[] = [];
    let chunk: number[] = [];
    const flush = () => {
      parts.push(String.fromCharCode(...chunk));
      chunk = [];
    };
    while (i < bytes.length) {
      const b = bytes[i++];
      let c: number;
      if (b < 0x80) c = b;
      else if (b >= 0xc2 && b < 0xe0 && i < bytes.length) c = ((b & 31) << 6) | (bytes[i++] & 63);
      else if (b >= 0xe0 && b < 0xf0 && i + 1 < bytes.length) c = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      else if (b >= 0xf0 && b < 0xf5 && i + 2 < bytes.length) c = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
      else c = 0xfffd;
      if (c > 0xffff) {
        c -= 0x10000;
        chunk.push(0xd800 + (c >> 10), 0xdc00 + (c & 1023));
      } else chunk.push(c);
      if (chunk.length > 8000) flush();
    }
    flush();
    return parts.join("");
  }
}

define("TextEncoder", TextEncoderPolyfill);
define("TextDecoder", TextDecoderPolyfill);
define("btoa", (s: string) => {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 255) throw new Error("btoa: character out of range");
    bytes[i] = c;
  }
  return toBase64(bytes);
});
define("atob", (s: string) => {
  const bytes = fromBase64(s.replace(/\s+/g, ""));
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
});

// ------------------------------------------------------------------ URL

const encodeQuery = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");
const decodeQuery = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};

class URLSearchParamsPolyfill {
  private list: [string, string][] = [];
  private onChange?: () => void;
  constructor(init?: string | Record<string, string> | Iterable<[string, string]> | URLSearchParamsPolyfill) {
    if (typeof init === "string") this.parse(init);
    else if (init instanceof URLSearchParamsPolyfill) this.list = [...init.list];
    else if (init && typeof (init as Iterable<unknown>)[Symbol.iterator] === "function") for (const [k, v] of init as Iterable<[string, string]>) this.list.push([String(k), String(v)]);
    else if (init) for (const [k, v] of Object.entries(init)) this.list.push([k, String(v)]);
  }
  /** @internal */ parse(query: string) {
    this.list = [];
    for (const part of query.replace(/^\?/, "").split("&")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      this.list.push(eq < 0 ? [decodeQuery(part), ""] : [decodeQuery(part.slice(0, eq)), decodeQuery(part.slice(eq + 1))]);
    }
  }
  /** @internal */ bind(fn: () => void) {
    this.onChange = fn;
  }
  get size() {
    return this.list.length;
  }
  append(k: string, v: string) {
    this.list.push([String(k), String(v)]);
    this.onChange?.();
  }
  delete(k: string) {
    this.list = this.list.filter(([n]) => n !== k);
    this.onChange?.();
  }
  get(k: string) {
    return this.list.find(([n]) => n === k)?.[1] ?? null;
  }
  getAll(k: string) {
    return this.list.filter(([n]) => n === k).map(([, v]) => v);
  }
  has(k: string) {
    return this.list.some(([n]) => n === k);
  }
  set(k: string, v: string) {
    const i = this.list.findIndex(([n]) => n === k);
    if (i < 0) this.list.push([k, String(v)]);
    else {
      this.list[i] = [k, String(v)];
      this.list = this.list.filter(([n], j) => n !== k || j === i);
    }
    this.onChange?.();
  }
  sort() {
    this.list.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    this.onChange?.();
  }
  forEach(fn: (v: string, k: string, p: this) => void) {
    for (const [k, v] of this.list) fn(v, k, this);
  }
  keys() {
    return this.list.map(([k]) => k)[Symbol.iterator]();
  }
  values() {
    return this.list.map(([, v]) => v)[Symbol.iterator]();
  }
  entries() {
    return this.list.map(([k, v]) => [k, v] as [string, string])[Symbol.iterator]();
  }
  [Symbol.iterator]() {
    return this.entries();
  }
  toString() {
    return this.list.map(([k, v]) => `${encodeQuery(k)}=${encodeQuery(v)}`).join("&");
  }
}

const URL_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*:)(?:\/\/(?:([^/?#@]*)@)?([^/?#:]*|\[[^\]]*\])(?::(\d*))?)?([^?#]*)(\?[^#]*)?(#.*)?$/;
const DEFAULT_PORTS: Record<string, string> = { "http:": "80", "https:": "443" };

function normalizePath(path: string): string {
  const out: string[] = [];
  for (const seg of path.split("/").slice(1)) {
    if (seg === "..") out.pop();
    else if (seg !== ".") out.push(seg);
  }
  return `/${out.join("/")}`;
}

class URLPolyfill {
  protocol = "";
  username = "";
  password = "";
  hostname = "";
  port = "";
  pathname = "/";
  hash = "";
  readonly searchParams: URLSearchParamsPolyfill;
  private _search = "";

  constructor(input: string | URLPolyfill, base?: string | URLPolyfill) {
    let href = String(input);
    if (!URL_PATTERN.test(href) || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
      if (base === undefined) throw new TypeError(`Invalid URL: ${href}`);
      const b = new URLPolyfill(String(base));
      if (href.startsWith("//")) href = `${b.protocol}${href}`;
      else if (href.startsWith("/")) href = `${b.origin}${href}`;
      else if (href.startsWith("?")) href = `${b.origin}${b.pathname}${href}`;
      else if (href.startsWith("#")) href = `${b.origin}${b.pathname}${b.search}${href}`;
      else href = `${b.origin}${b.pathname.replace(/[^/]*$/, "")}${href}`;
    }
    const m = URL_PATTERN.exec(href.trim());
    if (!m) throw new TypeError(`Invalid URL: ${href}`);
    this.protocol = m[1].toLowerCase();
    if (m[2]) [this.username, this.password = ""] = m[2].split(":");
    this.hostname = (m[3] ?? "").toLowerCase();
    this.port = m[4] && m[4] !== DEFAULT_PORTS[this.protocol] ? m[4] : "";
    this.pathname = m[3] !== undefined ? normalizePath(m[5] || "/") : m[5];
    this._search = m[6] && m[6] !== "?" ? m[6] : "";
    this.hash = m[7] && m[7] !== "#" ? m[7] : "";
    this.searchParams = new URLSearchParamsPolyfill(this._search);
    this.searchParams.bind(() => {
      const s = this.searchParams.toString();
      this._search = s ? `?${s}` : "";
    });
  }
  get search() {
    return this._search;
  }
  set search(value: string) {
    this._search = value && value !== "?" ? (value.startsWith("?") ? value : `?${value}`) : "";
    this.searchParams.parse(this._search);
  }
  get host() {
    return this.port ? `${this.hostname}:${this.port}` : this.hostname;
  }
  get origin() {
    return `${this.protocol}//${this.host}`;
  }
  get href() {
    const auth = this.username ? `${this.username}${this.password ? `:${this.password}` : ""}@` : "";
    return `${this.protocol}//${auth}${this.host}${this.pathname}${this._search}${this.hash}`;
  }
  toString() {
    return this.href;
  }
  toJSON() {
    return this.href;
  }
  static canParse(input: string, base?: string) {
    try {
      new URLPolyfill(input, base);
      return true;
    } catch {
      return false;
    }
  }
}

define("URLSearchParams", URLSearchParamsPolyfill);
define("URL", URLPolyfill);

// ------------------------------------------------------------------ Headers, Blob, FormData, streams

class HeadersPolyfill {
  private map = new Map<string, string>();
  constructor(init?: HeadersPolyfill | [string, string][] | Record<string, string>) {
    if (init instanceof HeadersPolyfill) init.forEach((v, k) => this.append(k, v));
    else if (Array.isArray(init)) for (const [k, v] of init) this.append(k, v);
    else if (init) for (const [k, v] of Object.entries(init)) this.append(k, v);
  }
  append(k: string, v: string) {
    const key = k.toLowerCase();
    const prev = this.map.get(key);
    this.map.set(key, prev === undefined ? String(v) : `${prev}, ${v}`);
  }
  set(k: string, v: string) {
    this.map.set(k.toLowerCase(), String(v));
  }
  get(k: string) {
    return this.map.get(k.toLowerCase()) ?? null;
  }
  has(k: string) {
    return this.map.has(k.toLowerCase());
  }
  delete(k: string) {
    this.map.delete(k.toLowerCase());
  }
  getSetCookie() {
    const v = this.map.get("set-cookie");
    return v ? [v] : [];
  }
  forEach(fn: (v: string, k: string, h: this) => void) {
    for (const [k, v] of this.entries()) fn(v, k, this);
  }
  entries() {
    return [...this.map.entries()].sort(([a], [b]) => (a < b ? -1 : 1))[Symbol.iterator]();
  }
  keys() {
    return [...this.map.keys()].sort()[Symbol.iterator]();
  }
  values() {
    return [...this.entries()].map(([, v]) => v)[Symbol.iterator]();
  }
  [Symbol.iterator]() {
    return this.entries();
  }
}

type BlobPart = string | ArrayBuffer | ArrayBufferView | BlobPolyfill;

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function toBytes(part: BlobPart): Uint8Array {
  if (typeof part === "string") return new TextEncoderPolyfill().encode(part);
  if (part instanceof BlobPolyfill) return part.bytesSync();
  if (part instanceof ArrayBuffer) return new Uint8Array(part);
  return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
}

class BlobPolyfill {
  readonly type: string;
  private data: Uint8Array;
  constructor(parts: BlobPart[] = [], options: { type?: string } = {}) {
    this.data = concat(parts.map(toBytes));
    this.type = (options.type ?? "").toLowerCase();
  }
  get size() {
    return this.data.length;
  }
  /** @internal */ bytesSync() {
    return this.data;
  }
  async bytes() {
    return this.data.slice();
  }
  async arrayBuffer() {
    return this.data.slice().buffer;
  }
  async text() {
    return new TextDecoderPolyfill().decode(this.data);
  }
  slice(start = 0, end = this.data.length, type = "") {
    return new BlobPolyfill([this.data.slice(start, end)], { type });
  }
  stream() {
    return streamOf(this.data);
  }
}

class FilePolyfill extends BlobPolyfill {
  readonly name: string;
  readonly lastModified: number;
  constructor(parts: BlobPart[], name: string, options: { type?: string; lastModified?: number } = {}) {
    super(parts, options);
    this.name = name;
    this.lastModified = options.lastModified ?? Date.now();
  }
}

class FormDataPolyfill {
  private list: [string, string | FilePolyfill][] = [];
  append(name: string, value: string | BlobPolyfill, filename?: string) {
    this.list.push([name, wrapEntry(value, filename)]);
  }
  set(name: string, value: string | BlobPolyfill, filename?: string) {
    this.delete(name);
    this.append(name, value, filename);
  }
  get(name: string) {
    return this.list.find(([n]) => n === name)?.[1] ?? null;
  }
  getAll(name: string) {
    return this.list.filter(([n]) => n === name).map(([, v]) => v);
  }
  has(name: string) {
    return this.list.some(([n]) => n === name);
  }
  delete(name: string) {
    this.list = this.list.filter(([n]) => n !== name);
  }
  forEach(fn: (v: string | FilePolyfill, k: string, f: this) => void) {
    for (const [k, v] of this.list) fn(v, k, this);
  }
  entries() {
    return this.list.map(([k, v]) => [k, v] as [string, string | FilePolyfill])[Symbol.iterator]();
  }
  keys() {
    return this.list.map(([k]) => k)[Symbol.iterator]();
  }
  values() {
    return this.list.map(([, v]) => v)[Symbol.iterator]();
  }
  [Symbol.iterator]() {
    return this.entries();
  }
}

function wrapEntry(value: string | BlobPolyfill, filename?: string): string | FilePolyfill {
  if (typeof value === "string") return value;
  if (value instanceof FilePolyfill && filename === undefined) return value;
  return new FilePolyfill([value], filename ?? (value instanceof FilePolyfill ? value.name : "blob"), { type: value.type });
}

/** A readable stream whose chunks are known up front (enqueued synchronously in `start`). */
class ReadableStreamPolyfill {
  /** @internal */ chunks: Uint8Array[] = [];
  /** @internal */ closed = false;
  locked = false;
  constructor(source?: { start?(controller: { enqueue(c: Uint8Array | string): void; close(): void; error(e: unknown): void }): unknown }) {
    const encoder = new TextEncoderPolyfill();
    source?.start?.({
      enqueue: (c) => this.chunks.push(typeof c === "string" ? encoder.encode(c) : toBytes(c)),
      close: () => (this.closed = true),
      error: (e) => {
        throw e;
      },
    });
  }
  getReader() {
    this.locked = true;
    let i = 0;
    return {
      read: async () => (i < this.chunks.length ? { done: false, value: this.chunks[i++] } : { done: true, value: undefined }),
      releaseLock: () => (this.locked = false),
      cancel: async () => undefined,
      closed: Promise.resolve(undefined),
    };
  }
  async cancel() {}
  async *[Symbol.asyncIterator]() {
    for (const c of this.chunks) yield c;
  }
}

function streamOf(bytes: Uint8Array): ReadableStreamPolyfill {
  return new ReadableStreamPolyfill({ start: (c) => (bytes.length && c.enqueue(bytes), c.close()) });
}

define("Headers", HeadersPolyfill);
define("Blob", BlobPolyfill);
define("File", FilePolyfill);
define("FormData", FormDataPolyfill);
define("ReadableStream", ReadableStreamPolyfill);

// ------------------------------------------------------------------ Request / Response

type BodyInit = string | ArrayBuffer | ArrayBufferView | BlobPolyfill | ReadableStreamPolyfill | URLSearchParamsPolyfill | FormDataPolyfill | null | undefined;

const BOUNDARY_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Turns a body into bytes plus the content type it implies. */
function extractBody(body: BodyInit): { bytes: Uint8Array | null; type: string | null } {
  if (body === null || body === undefined) return { bytes: null, type: null };
  const encoder = new TextEncoderPolyfill();
  if (typeof body === "string") return { bytes: encoder.encode(body), type: "text/plain;charset=UTF-8" };
  if (body instanceof URLSearchParamsPolyfill) return { bytes: encoder.encode(body.toString()), type: "application/x-www-form-urlencoded;charset=UTF-8" };
  if (body instanceof BlobPolyfill) return { bytes: body.bytesSync(), type: body.type || null };
  if (body instanceof ReadableStreamPolyfill) return { bytes: concat(body.chunks), type: null };
  if (body instanceof FormDataPolyfill) {
    let boundary = "----batzio";
    for (let i = 0; i < 24; i++) boundary += BOUNDARY_CHARS[Math.floor(Math.random() * BOUNDARY_CHARS.length)];
    const parts: Uint8Array[] = [];
    for (const [name, value] of body) {
      if (typeof value === "string") parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
      else {
        parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${value.name}"\r\nContent-Type: ${value.type || "application/octet-stream"}\r\n\r\n`));
        parts.push(value.bytesSync(), encoder.encode("\r\n"));
      }
    }
    parts.push(encoder.encode(`--${boundary}--\r\n`));
    return { bytes: concat(parts), type: `multipart/form-data; boundary=${boundary}` };
  }
  return { bytes: toBytes(body as ArrayBuffer | ArrayBufferView), type: null };
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** A parameter of a Content-Disposition header: quoted, bare, or `filename*=UTF-8''…` (as .NET sends it). */
function dispositionParam(header: string, key: string): string | undefined {
  const escaped = key.replace(/\*/g, "\\*");
  const m = new RegExp(`(?:^|;)\\s*${escaped}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^;]*))`, "i").exec(header);
  if (!m) return undefined;
  const value = m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2].trim();
  if (!key.endsWith("*")) return value;
  const ext = /^([\w-]+)'[^']*'(.*)$/.exec(value);
  try {
    return ext ? decodeURIComponent(ext[2]) : value;
  } catch {
    return value;
  }
}

function parseMultipart(bytes: Uint8Array, contentType: string): FormDataPolyfill {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) throw new TypeError("Missing multipart boundary");
  const encoder = new TextEncoderPolyfill();
  const decoder = new TextDecoderPolyfill();
  const delimiter = encoder.encode(`--${m[1] ?? m[2]}`);
  const form = new FormDataPolyfill();
  let pos = indexOf(bytes, delimiter, 0);
  while (pos >= 0) {
    let start = pos + delimiter.length;
    if (bytes[start] === 45 && bytes[start + 1] === 45) break; // closing "--"
    if (bytes[start] === 13 && bytes[start + 1] === 10) start += 2;
    const headerEnd = indexOf(bytes, encoder.encode("\r\n\r\n"), start);
    if (headerEnd < 0) break;
    const head = decoder.decode(bytes.subarray(start, headerEnd));
    const next = indexOf(bytes, delimiter, headerEnd + 4);
    if (next < 0) break;
    const content = bytes.slice(headerEnd + 4, next - 2); // strip the CRLF before the delimiter
    const disposition = /content-disposition:([^\r\n]*)/i.exec(head)?.[1] ?? "";
    const name = dispositionParam(disposition, "name") ?? "";
    const filename = dispositionParam(disposition, "filename*") ?? dispositionParam(disposition, "filename");
    const type = /content-type:\s*([^\r\n]*)/i.exec(head)?.[1]?.trim() ?? "";
    if (filename !== undefined) form.append(name, new FilePolyfill([content], filename, { type }));
    else form.append(name, decoder.decode(content));
    pos = next;
  }
  return form;
}

abstract class BodyMixin {
  /** @internal */ protected _bytes: Uint8Array | null;
  readonly headers: HeadersPolyfill;
  bodyUsed = false;
  constructor(body: BodyInit, headers: HeadersPolyfill) {
    const { bytes, type } = extractBody(body);
    this._bytes = bytes;
    this.headers = headers;
    if (type && !headers.has("content-type")) headers.set("content-type", type);
  }
  get body() {
    return this._bytes === null ? null : streamOf(this._bytes);
  }
  private consume(): Uint8Array {
    this.bodyUsed = true;
    return this._bytes ?? new Uint8Array(0);
  }
  async arrayBuffer() {
    return this.consume().slice().buffer;
  }
  async bytes() {
    return this.consume().slice();
  }
  async text() {
    return new TextDecoderPolyfill().decode(this.consume());
  }
  async json() {
    return JSON.parse(await this.text());
  }
  async blob() {
    return new BlobPolyfill([this.consume()], { type: this.headers.get("content-type") ?? "" });
  }
  async formData() {
    const type = this.headers.get("content-type") ?? "";
    const bytes = this.consume();
    if (type.includes("multipart/form-data")) return parseMultipart(bytes, type);
    const form = new FormDataPolyfill();
    for (const [k, v] of new URLSearchParamsPolyfill(new TextDecoderPolyfill().decode(bytes))) form.append(k, v);
    return form;
  }
}

class AbortSignalPolyfill {
  aborted = false;
  reason: unknown = undefined;
  onabort: (() => void) | null = null;
  addEventListener() {}
  removeEventListener() {}
  throwIfAborted() {
    if (this.aborted) throw this.reason;
  }
  static abort(reason?: unknown) {
    const s = new AbortSignalPolyfill();
    s.aborted = true;
    s.reason = reason;
    return s;
  }
  static timeout() {
    return new AbortSignalPolyfill();
  }
}

class AbortControllerPolyfill {
  readonly signal = new AbortSignalPolyfill();
  abort(reason?: unknown) {
    this.signal.aborted = true;
    this.signal.reason = reason;
    this.signal.onabort?.();
  }
}

class RequestPolyfill extends BodyMixin {
  readonly url: string;
  readonly method: string;
  readonly signal: AbortSignalPolyfill;
  constructor(input: string | URLPolyfill | RequestPolyfill, init: { method?: string; headers?: HeadersPolyfill | [string, string][] | Record<string, string>; body?: BodyInit; signal?: AbortSignalPolyfill } = {}) {
    const from = input instanceof RequestPolyfill ? input : null;
    super(init.body ?? (from ? from._bytes : null), new HeadersPolyfill(init.headers ?? from?.headers));
    this.url = from ? from.url : new URLPolyfill(String(input)).href;
    this.method = (init.method ?? from?.method ?? "GET").toUpperCase();
    this.signal = init.signal ?? new AbortSignalPolyfill();
  }
  clone() {
    return new RequestPolyfill(this);
  }
}

class ResponsePolyfill extends BodyMixin {
  readonly status: number;
  readonly statusText: string;
  readonly type = "default";
  readonly url = "";
  readonly redirected = false;
  constructor(body?: BodyInit, init: { status?: number; statusText?: string; headers?: HeadersPolyfill | [string, string][] | Record<string, string> } = {}) {
    super(body, new HeadersPolyfill(init.headers));
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? "";
  }
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  clone() {
    return new ResponsePolyfill(this._bytes, { status: this.status, statusText: this.statusText, headers: this.headers });
  }
  static json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
    const headers = new HeadersPolyfill(init.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new ResponsePolyfill(JSON.stringify(data), { ...init, headers });
  }
  static redirect(url: string, status = 302) {
    return new ResponsePolyfill(null, { status, headers: { location: url } });
  }
  static error() {
    return new ResponsePolyfill(null, { status: 0 });
  }
}

define("AbortSignal", AbortSignalPolyfill);
define("AbortController", AbortControllerPolyfill);
define("Request", RequestPolyfill);
define("Response", ResponsePolyfill);
define("fetch", async () => {
  throw new TypeError("Batzio is working offline on this device: there is no network access.");
});

// ------------------------------------------------------------------ crypto

function randomBytes(n: number): Uint8Array {
  return fromBase64(host().random(n));
}

const subtle = {
  async digest(algorithm: string | { name: string }, data: ArrayBuffer | ArrayBufferView) {
    const name = (typeof algorithm === "string" ? algorithm : algorithm.name).toUpperCase();
    if (name !== "SHA-256") throw new Error(`Unsupported digest: ${name}`);
    const bytes = toBytes(data as ArrayBuffer);
    const fast = host().sha256;
    return (fast ? fromBase64(fast(toBase64(bytes))) : sha256(bytes)).slice().buffer;
  },
  async importKey(_format: string, keyData: ArrayBuffer | ArrayBufferView, algorithm: string | { name: string }) {
    return { type: "secret", algorithm: typeof algorithm === "string" ? { name: algorithm } : algorithm, raw: toBytes(keyData as ArrayBuffer).slice() };
  },
  async deriveBits(params: { name: string; hash: string | { name: string }; salt: ArrayBuffer | ArrayBufferView; iterations: number }, key: { raw: Uint8Array }, length: number) {
    const hash = (typeof params.hash === "string" ? params.hash : params.hash.name).toUpperCase();
    if (params.name.toUpperCase() !== "PBKDF2" || hash !== "SHA-256") throw new Error("Only PBKDF2 with SHA-256 is available.");
    const salt = toBytes(params.salt as ArrayBuffer);
    const fast = host().pbkdf2;
    const bits = fast ? fromBase64(fast(toBase64(key.raw), toBase64(salt), params.iterations, length)) : pbkdf2Sha256(key.raw, salt, params.iterations, length / 8);
    return bits.slice().buffer;
  },
};

if (typeof g.crypto === "undefined") g.crypto = {};
const c = g.crypto as Record<string, unknown>;
if (typeof c.getRandomValues !== "function") {
  c.getRandomValues = <T extends ArrayBufferView>(array: T): T => {
    const bytes = randomBytes(array.byteLength);
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(bytes);
    return array;
  };
}
if (typeof c.randomUUID !== "function") {
  c.randomUUID = () => {
    const b = randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
}
if (typeof c.subtle === "undefined") c.subtle = subtle;
