import { describe, expect, it } from "vitest";
import { createOAuthAuthPort, deviceCodeGrant, oauthSecretKey } from "./mcpOAuth.js";

describe("MCP OAuth port", () => {
  it("stores and refreshes tokens without writing workspace files", async () => {
    const memory = new Map<string, string>();
    const port = createOAuthAuthPort(
      {
        authorize: async () => ({ accessToken: "a1", refreshToken: "r1", expiresAt: Date.now() + 60_000 }),
        refresh: async () => ({ accessToken: "a2", refreshToken: "r2", expiresAt: Date.now() + 60_000 }),
      },
      {
        get: async (key) => memory.get(key),
        set: async (key, value) => {
          memory.set(key, value);
        },
        delete: async (key) => {
          memory.delete(key);
        },
      },
    );
    const config = { name: "srv", auth: { type: "oauth" as const, flow: "device_code" as const } };
    expect(await port.token(config)).toBe("a1");
    expect(memory.get(oauthSecretKey(config))).toContain("a1");
    await port.onUnauthorized?.(config);
    expect(memory.size).toBe(0);
  });

  it("completes a mocked device-code grant", async () => {
    const grant = await deviceCodeGrant({
      deviceAuthorizationEndpoint: "https://auth.example/device",
      tokenEndpoint: "https://auth.example/token",
      clientId: "ninjacode",
      fetch: (async (url) => {
        if (String(url).includes("/device")) {
          return new Response(
            JSON.stringify({
              device_code: "dev",
              user_code: "ABCD",
              verification_uri: "https://auth.example/verify",
              interval: 0,
            }),
          );
        }
        return new Response(JSON.stringify({ access_token: "tok", expires_in: 60 }));
      }) as typeof fetch,
      onUserCode: async (info) => {
        expect(info.userCode).toBe("ABCD");
      },
    });
    expect(grant.accessToken).toBe("tok");
  });
});
