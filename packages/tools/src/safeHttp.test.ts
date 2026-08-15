import { describe, expect, it, vi } from "vitest";
import { isPublicAddress, safeHttpGet, type ResolvedAddress } from "./safeHttp.js";

async function* chunks(...values: string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield new TextEncoder().encode(value);
}

function response(
  status: number,
  headers: Record<string, string>,
  values: string[] = [],
) {
  return {
    status,
    headers,
    body: chunks(...values),
    dispose: vi.fn(async () => undefined),
  };
}

const publicAddress: ResolvedAddress[] = [{ address: "93.184.216.34", family: 4 }];

describe("isPublicAddress", () => {
  it("rejects private, metadata, multicast and mapped-private addresses", () => {
    const blocked = [
      "127.0.0.1",
      "10.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "224.0.0.1",
      "::1",
      "fe80::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
    ];
    for (const address of blocked) expect(isPublicAddress(address), address).toBe(false);
  });

  it("accepts globally routable IPv4 and IPv6 addresses", () => {
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
});

describe("safeHttpGet", () => {
  it("rejects direct and numerically encoded loopback hosts", async () => {
    const resolve = vi.fn(async (hostname: string) => [
      { address: hostname, family: 4 as const },
    ]);
    for (const url of ["http://127.0.0.1", "http://2130706433", "http://0x7f000001"]) {
      await expect(safeHttpGet(url, { dependencies: { resolve } })).rejects.toMatchObject({
        code: "permission",
      });
    }
  });

  it("rejects IPv4-mapped private addresses returned by DNS", async () => {
    await expect(
      safeHttpGet("https://mapped.test", {
        dependencies: {
          resolve: async () => [{ address: "::ffff:127.0.0.1", family: 6 }],
        },
      }),
    ).rejects.toMatchObject({ code: "permission" });
  });

  it("rejects a DNS answer when any address is non-public", async () => {
    await expect(
      safeHttpGet("https://mixed.test", {
        dependencies: {
          resolve: async () => [
            ...publicAddress,
            { address: "10.0.0.2", family: 4 },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "permission" });
  });

  it("revalidates DNS on every redirect", async () => {
    const resolve = vi.fn(async (hostname: string) =>
      hostname === "public.test"
        ? publicAddress
        : [{ address: "169.254.169.254", family: 4 as const }],
    );
    const transport = vi.fn(async () =>
      response(302, { location: "http://metadata.test/latest" }),
    );
    await expect(
      safeHttpGet("https://public.test/start", { dependencies: { resolve, transport } }),
    ).rejects.toMatchObject({ code: "permission" });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("passes the validated addresses to the transport for DNS pinning", async () => {
    const transport = vi.fn(async (_url, addresses) => {
      expect(addresses).toEqual(publicAddress);
      return response(200, { "content-type": "text/plain" }, ["hello"]);
    });
    const result = await safeHttpGet("https://example.test", {
      dependencies: { resolve: async () => publicAddress, transport },
    });
    expect(result.text).toBe("hello");
    expect(result.bytes).toBe(5);
  });

  it("permits an exact host:port allowlist entry", async () => {
    const transport = vi.fn(async () =>
      response(200, { "content-type": "application/json" }, ['{"ok":true}']),
    );
    const result = await safeHttpGet("http://internal.test:8080/status", {
      allowlist: new Set(["internal.test:8080"]),
      dependencies: {
        resolve: async () => [{ address: "10.0.0.5", family: 4 }],
        transport,
      },
    });
    expect(result.status).toBe(200);
  });

  it("rejects credentials, non-public ports and unsupported protocols", async () => {
    const dependencies = { resolve: async () => publicAddress };
    await expect(safeHttpGet("https://user:pass@example.test", { dependencies })).rejects.toMatchObject({
      code: "permission",
    });
    await expect(safeHttpGet("https://example.test:8443", { dependencies })).rejects.toMatchObject({
      code: "permission",
    });
    await expect(safeHttpGet("file:///etc/passwd", { dependencies })).rejects.toMatchObject({
      code: "invalid_args",
    });
  });

  it("rejects a simulated DNS rebinding after the public lookup", async () => {
    let lookups = 0;
    const resolve = vi.fn(async () => {
      lookups += 1;
      return lookups === 1 ? publicAddress : [{ address: "127.0.0.1", family: 4 as const }];
    });
    const transport = vi.fn(async (_url, addresses) => {
      expect(addresses).toEqual(publicAddress);
      return response(302, { location: "https://example.test/rebind" });
    });
    await expect(
      safeHttpGet("https://example.test/start", { dependencies: { resolve, transport } }),
    ).rejects.toMatchObject({ code: "permission" });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("aborts when the request exceeds timeoutMs", async () => {
    await expect(
      safeHttpGet("https://example.test", {
        timeoutMs: 5,
        dependencies: {
          resolve: async () => publicAddress,
          transport: async (_url, _addresses, signal) => {
            await new Promise((_, reject) => {
              signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            });
            return response(200, { "content-type": "text/plain" }, ["late"]);
          },
        },
      }),
    ).rejects.toThrow(/aborted|timeout/i);
  });

  it("bounds bytes before materializing the response", async () => {
    const transport = vi.fn(async () =>
      response(200, { "content-type": "text/plain" }, ["1234", "5678"]),
    );
    await expect(
      safeHttpGet("https://example.test", {
        maxBytes: 5,
        dependencies: { resolve: async () => publicAddress, transport },
      }),
    ).rejects.toThrow(/exceeds 5 bytes/);
  });

  it("rejects compressed and binary responses", async () => {
    const compressed = vi.fn(async () =>
      response(200, { "content-type": "text/plain", "content-encoding": "gzip" }),
    );
    await expect(
      safeHttpGet("https://example.test", {
        dependencies: { resolve: async () => publicAddress, transport: compressed },
      }),
    ).rejects.toThrow(/compressed response/i);

    const binary = vi.fn(async () =>
      response(200, { "content-type": "application/octet-stream" }),
    );
    await expect(
      safeHttpGet("https://example.test", {
        dependencies: { resolve: async () => publicAddress, transport: binary },
      }),
    ).rejects.toThrow(/unsupported content type/i);
  });
});
