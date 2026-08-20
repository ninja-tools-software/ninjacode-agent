import dns from "node:dns/promises";
import net from "node:net";
import type { LookupFunction } from "node:net";
import { Agent, request } from "undici";
import { ToolError } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface SafeHttpResponse {
  status: number;
  url: string;
  contentType: string;
  text: string;
  bytes: number;
}

interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<Uint8Array>;
  dispose: () => Promise<void>;
}

export interface SafeHttpDependencies {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  transport?: (
    url: URL,
    addresses: ResolvedAddress[],
    signal: AbortSignal,
  ) => Promise<TransportResponse>;
}

export interface SafeHttpOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  allowlist?: ReadonlySet<string>;
  dependencies?: SafeHttpDependencies;
}

function ipv4Value(address: string): number | null {
  if (net.isIP(address) !== 4) return null;
  return address.split(".").reduce((value, part) => value * 256 + Number(part), 0) >>> 0;
}

function inV4Range(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

const BLOCKED_V4: Array<[number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

function expandIpv6(address: string): number[] | null {
  if (net.isIP(address) !== 6) return null;
  const zoneFree = address.split("%")[0]!;
  const [leftRaw, rightRaw = ""] = zoneFree.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const convertV4 = (parts: string[]): string[] => {
    const last = parts.at(-1);
    const v4 = last ? ipv4Value(last) : null;
    return v4 === null
      ? parts
      : [...parts.slice(0, -1), ((v4 >>> 16) & 0xffff).toString(16), (v4 & 0xffff).toString(16)];
  };
  const l = convertV4(left);
  const r = convertV4(right);
  const missing = 8 - l.length - r.length;
  if (missing < 0 || (!address.includes("::") && missing !== 0)) return null;
  const groups = [...l, ...Array.from({ length: missing }, () => "0"), ...r];
  if (groups.length !== 8) return null;
  const numbers = groups.map((group) => Number.parseInt(group || "0", 16));
  return numbers.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff)
    ? numbers
    : null;
}

function ipv6Value(address: string): bigint | null {
  const groups = expandIpv6(address);
  if (!groups) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(group), 0n);
}

function ipv6Prefix(value: bigint, prefix: number): bigint {
  return value >> BigInt(128 - prefix);
}

function mappedIpv4(address: string): string | null {
  const groups = expandIpv6(address);
  if (!groups || groups.slice(0, 5).some((part) => part !== 0) || groups[5] !== 0xffff) return null;
  return `${groups[6]! >>> 8}.${groups[6]! & 255}.${groups[7]! >>> 8}.${groups[7]! & 255}`;
}

export function isPublicAddress(address: string): boolean {
  const v4 = ipv4Value(address);
  if (v4 !== null) return !BLOCKED_V4.some(([base, prefix]) => inV4Range(v4, base, prefix));
  const mapped = mappedIpv4(address);
  if (mapped) return isPublicAddress(mapped);
  const v6 = ipv6Value(address);
  if (v6 === null) return false;
  // Only 2000::/3 is globally routable. Exclude documentation, transition,
  // discard-only and IETF protocol blocks inside it.
  if (ipv6Prefix(v6, 3) !== 1n) return false;
  if (ipv6Prefix(v6, 32) === 0x20010db8n) return false;
  if (ipv6Prefix(v6, 23) === (0x200100n >> 1n)) return false;
  if (ipv6Prefix(v6, 16) === 0x2002n) return false;
  return true;
}

function effectivePort(url: URL): number {
  return Number(url.port || (url.protocol === "https:" ? 443 : 80));
}

function allowlistKey(url: URL): string {
  return `${url.hostname.toLowerCase()}:${effectivePort(url)}`;
}

function validateUrl(url: URL, allowlist: ReadonlySet<string>): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ToolError(`Unsupported protocol: ${url.protocol}`, "invalid_args");
  }
  if (url.username || url.password) {
    throw new ToolError("URL credentials are not allowed", "permission");
  }
  const explicitlyAllowed = allowlist.has(allowlistKey(url));
  if (![80, 443].includes(effectivePort(url)) && !explicitlyAllowed) {
    throw new ToolError(`Port ${effectivePort(url)} is not allowed`, "permission");
  }
  return explicitlyAllowed;
}

async function resolveHost(hostname: string): Promise<ResolvedAddress[]> {
  const literalFamily = net.isIP(hostname);
  if (literalFamily) return [{ address: hostname, family: literalFamily as 4 | 6 }];
  const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
  return resolved.map(({ address, family }) => ({ address, family: family as 4 | 6 }));
}

function validateAddresses(addresses: ResolvedAddress[], explicitlyAllowed: boolean): void {
  if (addresses.length === 0) throw new ToolError("DNS returned no addresses", "runtime");
  if (!explicitlyAllowed) {
    const blocked = addresses.find(({ address }) => !isPublicAddress(address));
    if (blocked) throw new ToolError(`Blocked non-public address: ${blocked.address}`, "permission");
  }
}

function createPinnedLookup(addresses: ResolvedAddress[]): LookupFunction {
  return ((
    _hostname: string,
    options: { all?: boolean; family?: number | "IPv4" | "IPv6" },
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | ResolvedAddress[],
      family?: number,
    ) => void,
  ) => {
    const requestedFamily =
      options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family;
    const candidates = requestedFamily
      ? addresses.filter((entry) => entry.family === requestedFamily)
      : addresses;
    if (candidates.length === 0) {
      callback(Object.assign(new Error("No pinned address for requested family"), { code: "ENOTFOUND" }), "");
      return;
    }
    if (options.all) callback(null, candidates);
    else callback(null, candidates[0]!.address, candidates[0]!.family);
  }) as LookupFunction;
}

async function pinnedTransport(
  url: URL,
  addresses: ResolvedAddress[],
  signal: AbortSignal,
): Promise<TransportResponse> {
  const dispatcher = new Agent({ connect: { lookup: createPinnedLookup(addresses) } });
  try {
    const response = await request(url, {
      dispatcher,
      signal,
      headers: {
        "user-agent": "NinjaCode (+https://ninjacode.dev)",
        "accept-encoding": "identity",
        accept: "text/*, application/json, application/xml, application/xhtml+xml",
      },
    });
    const headers = Object.fromEntries(
      Object.entries(response.headers).map(([key, value]) => [
        key.toLowerCase(),
        Array.isArray(value) ? value.join(", ") : String(value ?? ""),
      ]),
    );
    return {
      status: response.statusCode,
      headers,
      body: response.body,
      dispose: async () => {
        await response.body.dump().catch(() => undefined);
        await dispatcher.close();
      },
    };
  } catch (error) {
    await dispatcher.close();
    throw error;
  }
}

function acceptedContentType(contentType: string): boolean {
  const mime = contentType.split(";")[0]!.trim().toLowerCase();
  return (
    !mime ||
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime.endsWith("+json") ||
    mime === "application/xml" ||
    mime.endsWith("+xml") ||
    mime === "application/javascript"
  );
}

async function readBody(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new ToolError(`Response exceeds ${maxBytes} bytes`, "runtime");
    chunks.push(chunk);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function safeHttpGet(rawUrl: string, options: SafeHttpOptions = {}): Promise<SafeHttpResponse> {
  const allowlist = options.allowlist ?? new Set<string>();
  const resolve = options.dependencies?.resolve ?? resolveHost;
  const transport = options.dependencies?.transport ?? pinnedTransport;
  const signal = combinedSignal(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxBytes = Math.min(Math.max(options.maxBytes ?? DEFAULT_MAX_BYTES, 1), 8 * 1024 * 1024);
  let current: URL;
  try {
    current = new URL(rawUrl);
  } catch {
    throw new ToolError(`Invalid URL: ${rawUrl}`, "invalid_args");
  }

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const explicitlyAllowed = validateUrl(current, allowlist);
    const addresses = await resolve(current.hostname);
    validateAddresses(addresses, explicitlyAllowed);
    const response = await transport(current, addresses, signal);
    const location = response.headers.location;
    if (REDIRECT_STATUS.has(response.status) && location) {
      await response.dispose();
      if (redirect === MAX_REDIRECTS) throw new ToolError("Too many redirects", "runtime");
      current = new URL(location, current);
      continue;
    }
    const contentType = response.headers["content-type"] ?? "";
    const encoding = (response.headers["content-encoding"] ?? "identity").toLowerCase();
    const declared = Number(response.headers["content-length"] ?? "0");
    if (encoding !== "identity") {
      await response.dispose();
      throw new ToolError(`Compressed response is not accepted: ${encoding}`, "runtime");
    }
    if (!acceptedContentType(contentType)) {
      await response.dispose();
      throw new ToolError(`Unsupported content type: ${contentType}`, "runtime");
    }
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.dispose();
      throw new ToolError(`Response exceeds ${maxBytes} bytes`, "runtime");
    }
    try {
      const bytes = await readBody(response.body, maxBytes);
      return {
        status: response.status,
        url: current.toString(),
        contentType,
        text: new TextDecoder().decode(bytes),
        bytes: bytes.byteLength,
      };
    } finally {
      await response.dispose();
    }
  }
  throw new ToolError("Too many redirects", "runtime");
}
